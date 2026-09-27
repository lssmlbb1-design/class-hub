// ============================================================
// CLASS HUB — Google Apps Script (Telegram + Google Forms + Sheets)
// ============================================================
// Цель: связать Telegram-бот, Google Таблицу и Google Формы,
// обеспечить обработку текстовых вопросов, заявок и админских сценариев,
// а также безопасно отправлять уведомления через Telegram API.
// ============================================================

const BOT_TOKEN = '8727223928:AAHCu-jJhFWmyqY4r0iUPWOJD445SbZNa9o';
const SPREADSHEET_ID = '1ygTKJmW_9GWwPspc1RY2yJjvfI8WT5XsFf2NNZuAT_M';
const WEBHOOK_URL = 'https://class-hub.nureldinmuhamedov010410.workers.dev/';
const WEBHOOK_SECRET = '1234899384';

const SHEET_NAMES = {
  projects: 'Projects',
  joinRequests: 'Join_Requests',
  adminIds: 'Admin_IDs',
  deadlines: 'Deadlines',
  homeworkPool: 'Homework_Pool',
  schedule: 'Schedule',
  groups: 'Groups',
  syllabus: 'Syllabus',
  studentProjects: 'Student_Projects'
};

const FORM_TITLES = {
  adminForm: 'Админская форма проекта',
  studentForm: 'Создать команду проекта',
  joinRequestForm: 'Заявка на вступление в команду'
};

const CONFIG = {
  TEAM_FORM_ID: '1ygTKJmW_9GWwPspc1RY2yJjvfI8WT5XsFf2NNZuAT_M',
  SHEETS: {
    DEADLINES: 'Deadlines',
    PROJECTS: 'Projects',
    STUDENT_PROJECTS: 'Student_Projects',
    RESPONSES_DEADLINES: 'Form Responses 1',
    RESPONSES_PROJECTS: 'Form Responses 2'
  }
};

const SCHEDULE_ANCHOR_MONDAY = '2026-09-07';
const SCHEDULE_ANCHOR_WEEK_TYPE = 1;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ============================================================
// 1. WEBHOOK / doPost / Telegram message processing
// ============================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('⚠️ Пустой POST запрос');
      return HtmlService.createHtmlOutput('No data');
    }

    const data = JSON.parse(e.postData.contents);

    if (data.message) {
      handleTextMessage(data.message);
    } else if (data.callback_query) {
      handleTelegramCallbackQuery(data.callback_query);
    } else if (data.action === 'addProject') {
      handleWebsiteProjectRequest(data);
    }

    return HtmlService.createHtmlOutput('OK');
  } catch (error) {
    Logger.log('❌ Ошибка doPost: ' + error.toString());
    return HtmlService.createHtmlOutput('ERROR');
  }
}

function handleTextMessage(message) {
  try {
    const chatId = message && message.chat && message.chat.id;
    const text = (message && (message.text || message.caption) || '').trim();

    if (!chatId || !text) return;

    if (text.startsWith('/start') || text.startsWith('/help')) {
      const helpText = '👋 Привет! Я Class Hub бот.\n\n' +
        'Я могу помочь с:\n' +
        '• ДЗ и дедлайнами\n' +
        '• Расписанием\n' +
        '• Проектами и командами\n\n' +
        'Например: «Что задавали по математике?»';
      sendTelegramMessage(chatId, helpText);
      return;
    }

    const replyText = processUserQuery(text);
    if (replyText) {
      sendTelegramMessage(chatId, replyText);
    }
  } catch (error) {
    Logger.log('❌ Ошибка handleTextMessage: ' + error.toString());
    if (message && message.chat && message.chat.id) {
      sendTelegramMessage(message.chat.id, '❌ Произошла ошибка при обработке запроса. Попробуйте позже.');
    }
  }
}

function handleTelegramCallbackQuery(callbackQuery) {
  try {
    if (!callbackQuery || !callbackQuery.data) {
      return;
    }

    const callbackId = callbackQuery.id;
    const userId = String(callbackQuery.from && callbackQuery.from.id || '');
    const data = callbackQuery.data;

    if (data.indexOf('app_') === 0) {
      const requestId = data.replace(/^app_/, '');
      handleApproveRequest(requestId, userId, callbackId);
      return;
    }

    if (data.indexOf('rej_') === 0) {
      const requestId = data.replace(/^rej_/, '');
      handleRejectRequest(requestId, userId, callbackId);
      return;
    }

    answerCallbackQuery(callbackId, 'Неизвестный action', true);
  } catch (error) {
    Logger.log('❌ Ошибка handleTelegramCallbackQuery: ' + error.toString());
  }
}

function handleApproveRequest(requestId, userId, callbackId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      answerCallbackQuery(callbackId, 'Операция занята. Попробуйте позже.', true);
      return;
    }

    try {
      const joinSheet = ss.getSheetByName(SHEET_NAMES.joinRequests);
      const projectsSheet = ss.getSheetByName(SHEET_NAMES.projects);

      if (!joinSheet || !projectsSheet) {
        answerCallbackQuery(callbackId, 'Лист заявки или проекта не найден.', true);
        return;
      }

      const joinData = joinSheet.getDataRange().getValues();
      const projectsData = projectsSheet.getDataRange().getValues();

      let requestRow = -1;
      let projectId = '';
      let studentTelegramId = '';
      let studentName = '';

      for (let i = 1; i < joinData.length; i++) {
        if (String(joinData[i][0]).trim() === String(requestId).trim()) {
          requestRow = i;
          projectId = String(joinData[i][1] || '').trim();
          studentTelegramId = String(joinData[i][2] || '').trim();
          studentName = String(joinData[i][3] || '').trim();
          break;
        }
      }

      if (requestRow === -1) {
        answerCallbackQuery(callbackId, 'Заявка не найдена.', true);
        return;
      }

      let projectRow = -1;
      let leaderTelegramId = '';
      let projectName = '';
      let maxCapacity = 0;
      let currentCount = 0;
      let approvedMembers = '';

      for (let i = 1; i < projectsData.length; i++) {
        if (String(projectsData[i][0]).trim() === String(projectId).trim()) {
          projectRow = i;
          leaderTelegramId = String(projectsData[i][5] || '').trim();
          projectName = String(projectsData[i][1] || '').trim();
          maxCapacity = Number(projectsData[i][3]) || 0;
          currentCount = Number(projectsData[i][4]) || 0;
          approvedMembers = String(projectsData[i][6] || '').trim();
          break;
        }
      }

      if (projectRow === -1) {
        answerCallbackQuery(callbackId, 'Проект не найден.', true);
        return;
      }

      if (String(leaderTelegramId) !== String(userId)) {
        answerCallbackQuery(callbackId, 'У вас нет права подтверждать эту заявку.', true);
        return;
      }

      if (currentCount >= maxCapacity) {
        answerCallbackQuery(callbackId, 'Нет свободных мест в проекте.', true);
        return;
      }

      const members = approvedMembers ? approvedMembers.split(',').map(v => String(v).trim()).filter(Boolean) : [];
      if (!members.includes(studentTelegramId)) {
        members.push(studentTelegramId);
      }

      projectsSheet.getRange(projectRow + 1, 5).setValue(members.length);
      projectsSheet.getRange(projectRow + 1, 7).setValue(members.join(', '));
      joinSheet.getRange(requestRow + 1, 5).setValue('Approved');

      sendTelegramMessage(
        studentTelegramId,
        '✅ <b>Ваша заявка принята</b>\n\n' +
        'Проект: <b>' + esc(projectName) + '</b>\n' +
        'Статус: участник добавлен в команду.'
      );

      answerCallbackQuery(callbackId, '✅ Заявка подтверждена', false);
      Logger.log('✅ Заявка ' + requestId + ' одобрена.');
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    Logger.log('❌ Ошибка handleApproveRequest: ' + error.toString());
    answerCallbackQuery(callbackId, 'Ошибка при approval', true);
  }
}

function handleRejectRequest(requestId, userId, callbackId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      answerCallbackQuery(callbackId, 'Операция занята. Попробуйте позже.', true);
      return;
    }

    try {
      const joinSheet = ss.getSheetByName(SHEET_NAMES.joinRequests);
      const projectsSheet = ss.getSheetByName(SHEET_NAMES.projects);

      if (!joinSheet || !projectsSheet) {
        answerCallbackQuery(callbackId, 'Лист заявки или проекта не найден.', true);
        return;
      }

      const joinData = joinSheet.getDataRange().getValues();
      const projectsData = projectsSheet.getDataRange().getValues();

      let requestRow = -1;
      let projectId = '';
      let studentTelegramId = '';
      let studentName = '';

      for (let i = 1; i < joinData.length; i++) {
        if (String(joinData[i][0]).trim() === String(requestId).trim()) {
          requestRow = i;
          projectId = String(joinData[i][1] || '').trim();
          studentTelegramId = String(joinData[i][2] || '').trim();
          studentName = String(joinData[i][3] || '').trim();
          break;
        }
      }

      if (requestRow === -1) {
        answerCallbackQuery(callbackId, 'Заявка не найдена.', true);
        return;
      }

      let projectRow = -1;
      let leaderTelegramId = '';
      let projectName = '';

      for (let i = 1; i < projectsData.length; i++) {
        if (String(projectsData[i][0]).trim() === String(projectId).trim()) {
          projectRow = i;
          leaderTelegramId = String(projectsData[i][5] || '').trim();
          projectName = String(projectsData[i][1] || '').trim();
          break;
        }
      }

      if (projectRow === -1) {
        answerCallbackQuery(callbackId, 'Проект не найден.', true);
        return;
      }

      if (String(leaderTelegramId) !== String(userId)) {
        answerCallbackQuery(callbackId, 'У вас нет права отклонять эту заявку.', true);
        return;
      }

      joinSheet.getRange(requestRow + 1, 5).setValue('Rejected');

      sendTelegramMessage(
        studentTelegramId,
        '❌ <b>Ваша заявка отклонена</b>\n\n' +
        'Проект: <b>' + esc(projectName) + '</b>\n' +
        'Лидер отклонил вашу заявку.'
      );

      answerCallbackQuery(callbackId, '✅ Заявка отклонена', false);
      Logger.log('❌ Заявка ' + requestId + ' отклонена.');
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    Logger.log('❌ Ошибка handleRejectRequest: ' + error.toString());
    answerCallbackQuery(callbackId, 'Ошибка при rejection', true);
  }
}

// ============================================================
// 2. Google Forms processing
// ============================================================

function onFormSubmit(e) {
  try {
    if (!e || !e.source) return;

    const form = FormApp.openById(e.source.getId());
    const title = form.getTitle();

    Logger.log('📋 Получена форма: ' + title);

    if (title.indexOf(FORM_TITLES.adminForm) !== -1) {
      handleAdminForm(e);
    } else if (title.indexOf(FORM_TITLES.studentForm) !== -1) {
      handleStudentForm(e);
    } else if (title.indexOf(FORM_TITLES.joinRequestForm) !== -1) {
      handleJoinRequestForm(e);
    } else {
      Logger.log('⚠️ Неизвестная форма: ' + title);
    }
  } catch (error) {
    Logger.log('❌ Ошибка onFormSubmit: ' + error.toString());
  }
}

function handleAdminForm(e) {
  try {
    const values = e.values || [];
    if (values.length < 6) {
      Logger.log('⚠️ Админская форма пришла не в полном составе');
      return;
    }

    const projectName = String(values[1] || '').trim();
    const subject = String(values[2] || '').trim();
    const maxCapacity = Number(values[3]) || 0;
    const deadline = String(values[4] || '').trim();
    const leaderTelegramId = String(values[5] || '').trim();

    if (!projectName || !subject) {
      Logger.log('⚠️ Недостаточно данных для создания проекта');
      return;
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.projects);
    if (!sheet) {
      Logger.log('❌ Лист Projects не найден');
      return;
    }

    const projectId = 'PRJ-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

    sheet.appendRow([
      projectId,
      projectName,
      subject,
      maxCapacity,
      0,
      leaderTelegramId,
      '',
      deadline,
      'Active'
    ]);

    Logger.log('✅ Проект добавлен: ' + projectId + ' / ' + projectName);

    if (leaderTelegramId) {
      sendTelegramMessage(
        leaderTelegramId,
        '✅ <b>Проект создан</b>\n\n' +
        'Название: <b>' + esc(projectName) + '</b>\n' +
        'ID: <b>' + projectId + '</b>\n' +
        'Предмет: ' + esc(subject) + '\n' +
        'Мест: ' + maxCapacity + '\n' +
        'Дедлайн: ' + esc(deadline)
      );
    }
  } catch (error) {
    Logger.log('❌ Ошибка handleAdminForm: ' + error.toString());
  }
}

function handleStudentForm(e) {
  try {
    const values = e.values || [];
    if (values.length < 5) {
      Logger.log('⚠️ Студенческая форма пришла не в полном составе');
      return;
    }

    const projectName = String(values[1] || '').trim();
    const subject = String(values[2] || '').trim();
    const maxCapacity = Number(values[3]) || 0;
    const leaderTelegramId = String(values[4] || '').trim();

    if (!projectName || !subject || !leaderTelegramId) {
      Logger.log('⚠️ Не заполнены обязательные поля формы создания команды');
      return;
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.projects);
    if (!sheet) {
      Logger.log('❌ Лист Projects не найден');
      return;
    }

    const projectId = 'PRJ-STU-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

    sheet.appendRow([
      projectId,
      projectName,
      subject,
      maxCapacity,
      1,
      leaderTelegramId,
      leaderTelegramId,
      '',
      'Active'
    ]);

    sendTelegramMessage(
      leaderTelegramId,
      '🎉 <b>Команда создана</b>\n\n' +
      'Проект: <b>' + esc(projectName) + '</b>\n' +
      'ID: <b>' + projectId + '</b>\n' +
      'Предмет: ' + esc(subject) + '\n' +
      'Мест: ' + maxCapacity + '\n\n' +
      'Теперь студенты могут подавать заявки на вступление.'
    );

    Logger.log('✅ Команда создана студентом: ' + projectId);
  } catch (error) {
    Logger.log('❌ Ошибка handleStudentForm: ' + error.toString());
  }
}

function handleJoinRequestForm(e) {
  try {
    const values = e.values || [];
    if (values.length < 4) {
      Logger.log('⚠️ Форма заявки пришла не в полном составе');
      return;
    }

    const projectId = String(values[1] || '').trim();
    const studentTelegramId = String(values[2] || '').trim();
    const studentName = String(values[3] || '').trim();

    if (!projectId || !studentTelegramId) {
      Logger.log('⚠️ В заявке отсутствуют обязательные поля');
      return;
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const joinSheet = ss.getSheetByName(SHEET_NAMES.joinRequests);
    if (!joinSheet) {
      Logger.log('❌ Лист Join_Requests не найден');
      return;
    }

    const requestId = 'REQ-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

    joinSheet.appendRow([
      requestId,
      projectId,
      studentTelegramId,
      studentName,
      'Pending'
    ]);

    const projectsSheet = ss.getSheetByName(SHEET_NAMES.projects);
    const projectsData = projectsSheet.getDataRange().getValues();

    let leaderTelegramId = '';
    let projectName = '';

    for (let i = 1; i < projectsData.length; i++) {
      if (String(projectsData[i][0]).trim() === String(projectId).trim()) {
        leaderTelegramId = String(projectsData[i][5] || '').trim();
        projectName = String(projectsData[i][1] || '').trim();
        break;
      }
    }

    if (leaderTelegramId) {
      const buttons = [[
        { text: '✅ Принять', callback_data: 'approve_' + requestId },
        { text: '❌ Отклонить', callback_data: 'reject_' + requestId }
      ]];

      sendTelegramMessageWithButtons(
        leaderTelegramId,
        '📩 <b>Новая заявка на вступление</b>\n\n' +
        'Студент: <b>' + esc(studentName) + '</b>\n' +
        'Проект: <b>' + esc(projectName) + '</b>\n' +
        'Request ID: ' + requestId,
        buttons
      );
    }

    sendTelegramMessage(
      studentTelegramId,
      '📨 <b>Заявка отправлена</b>\n\n' +
      'Проект: <b>' + esc(projectName) + '</b>\n' +
      'Статус: ожидание решения лидера.'
    );

    Logger.log('✅ Заявка создана: ' + requestId);
  } catch (error) {
    Logger.log('❌ Ошибка handleJoinRequestForm: ' + error.toString());
  }
}

// ============================================================
// 3. Spreadsheet data reading logic for Telegram questions
// ============================================================

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h).trim());
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    if (values[i].every(c => c === '' || c === null || c === undefined)) continue;

    const obj = {};
    headers.forEach((header, idx) => {
      let value = values[i][idx];
      if (value instanceof Date) {
        value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[header] = value;
    });
    rows.push(obj);
  }

  return rows;
}

function processUserQuery(userMessage) {
  try {
    const query = String(userMessage || '').trim();
    if (!query) {
      return '❓ Напишите вопрос, например: «Что задавали по математике?»';
    }

    const normalized = query.toLowerCase();

    if (normalized.includes('проект') || normalized.includes('команда') || normalized.includes('группа')) {
      return findProjectsForTelegram();
    }

    if (normalized.includes('расписан') || normalized.includes('занят') || normalized.includes('когда')) {
      return findScheduleForTelegram();
    }

    if (
      normalized.includes('дз') ||
      normalized.includes('домаш') ||
      normalized.includes('задан') ||
      normalized.includes('задавали') ||
      normalized.includes('дедлайн') ||
      normalized.includes('по ') ||
      normalized.includes('матем') ||
      normalized.includes('физик') ||
      normalized.includes('русск')
    ) {
      return findHomeworkForTelegram(query);
    }

    return '❓ Я не понял ваш вопрос. Попробуйте: «Что задавали по математике?» или «Какие проекты есть?»';
  } catch (error) {
    Logger.log('❌ Ошибка processUserQuery: ' + error.toString());
    return '❌ Не удалось обработать запрос. Попробуйте позже.';
  }
}

function findHomeworkForTelegram(query) {
  try {
    const subject = extractSubjectFromQuery(query);
    const rows = [];

    const hwRows = getSheetData(SHEET_NAMES.homeworkPool);
    hwRows.forEach(function (row) {
      const rowSubject = String(row.Subject || '').trim();
      const status = String(row.Status || 'Active').trim().toLowerCase();

      if (status && status !== 'active') return;
      if (subject && rowSubject.toLowerCase().indexOf(subject.toLowerCase()) === -1) return;

      rows.push({
        subject: rowSubject,
        task: row.Task_Description || row.Task || '',
        date: row.Deadline_Date || row.Date || ''
      });
    });

    if (rows.length === 0) {
      const deadlineRows = getSheetData(SHEET_NAMES.deadlines);
      deadlineRows.forEach(function (row) {
        const rowSubject = String(row.Subject || '').trim();
        if (subject && rowSubject.toLowerCase().indexOf(subject.toLowerCase()) === -1) return;
        rows.push({
          subject: rowSubject,
          task: row.Task || row.Task_Description || '',
          date: row.Date || row.Deadline_Date || ''
        });
      });
    }

    if (rows.length === 0) {
      return subject
        ? '📋 По предмету «' + esc(subject) + '» заданий не найдено.'
        : '📋 Заданий пока не найдено.';
    }

    let result = '📚 <b>Найдены задания:</b>\n\n';
    rows.slice(0, 10).forEach(function (r, index) {
      result += (index + 1) + '. <b>[' + esc(r.subject || 'Без предмета') + ']</b>: ' + esc(r.task || 'Без текста');
      if (r.date) result += ' — <i>' + esc(r.date) + '</i>';
      result += '\n';
    });

    if (rows.length > 10) {
      result += '\n... и ещё ' + (rows.length - 10) + ' записей';
    }

    return result;
  } catch (error) {
    Logger.log('❌ Ошибка findHomeworkForTelegram: ' + error.toString());
    return '❌ Не удалось прочитать данные из таблицы.';
  }
}

function findScheduleForTelegram() {
  try {
    const rows = getSheetData(SHEET_NAMES.schedule);
    if (!rows.length) {
      return '📅 Расписание пока не найдено.';
    }

    let result = '📅 <b>Расписание:</b>\n\n';
    rows.slice(0, 15).forEach(function (r, index) {
      result += (index + 1) + '. <b>' + esc(r.Day || 'День') + '</b> — ' + esc(r.Subject || 'Предмет') + ' (' + esc(r.Time || 'Время') + ')';
      if (r.Task) result += ' — ' + esc(r.Task);
      result += '\n';
    });

    return result;
  } catch (error) {
    Logger.log('❌ Ошибка findScheduleForTelegram: ' + error.toString());
    return '❌ Не удалось прочитать расписание.';
  }
}

function findProjectsForTelegram() {
  try {
    const rows = getSheetData(SHEET_NAMES.projects).filter(function (row) {
      const status = String(row.Status || 'Active').trim().toLowerCase();
      return status !== 'expired' && status !== 'archived' && status !== 'closed';
    });

    if (!rows.length) {
      return '📦 Активных проектов пока нет.';
    }

    let result = '📦 <b>Активные проекты:</b>\n\n';
    rows.slice(0, 10).forEach(function (row, index) {
      const currentCount = Number(row.Current_Count) || 0;
      const maxCapacity = Number(row.Max_Capacity) || 0;
      const freePlaces = Math.max(0, maxCapacity - currentCount);
      result += (index + 1) + '. <b>' + esc(row.Project_Name || 'Без названия') + '</b>\n';
      result += '   📚 ' + esc(row.Subject || 'Предмет') + '\n';
      result += '   👥 Свободно: ' + freePlaces + '/' + maxCapacity + '\n';
      if (row.Deadline) result += '   📅 ' + esc(row.Deadline) + '\n';
      result += '\n';
    });

    return result;
  } catch (error) {
    Logger.log('❌ Ошибка findProjectsForTelegram: ' + error.toString());
    return '❌ Не удалось прочитать проекты.';
  }
}

function extractSubjectFromQuery(query) {
  try {
    const text = String(query || '').toLowerCase();
    const match = text.match(/по\s+([а-яёa-z0-9\-_ ]+)/i);
    if (!match) return '';

    let subject = match[1].trim();
    subject = subject.replace(/\s+(что|задали|задавали|домашка|дз|сегодня|сейчас)$/i, '');
    return subject;
  } catch (error) {
    Logger.log('❌ Ошибка extractSubjectFromQuery: ' + error.toString());
    return '';
  }
}

// ============================================================
// 4. Telegram API helpers
// ============================================================

function sendTelegramMessage(chatId, text) {
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
  const payload = {
    chat_id: String(chatId),
    text: text,
    parse_mode: 'HTML'
  };

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function sendTelegramMessageWithButtons(chatId, text, buttons) {
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
  const payload = {
    chat_id: String(chatId),
    text: text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: buttons
    }
  };

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function answerCallbackQuery(callbackId, text, showAlert) {
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery';
  const payload = {
    callback_query_id: callbackId,
    text: text,
    show_alert: !!showAlert
  };

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// ============================================================
// 5. Website / API for mini app
// ============================================================

function getProjectsForWebsite() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const projectsSheet = ss.getSheetByName(SHEET_NAMES.projects);
    if (!projectsSheet) return [];

    const rows = projectsSheet.getDataRange().getValues();
    const result = [];

    for (let i = 1; i < rows.length; i++) {
      const status = String(rows[i][8] || 'Active').trim().toLowerCase();
      if (status === 'closed' || status === 'expired' || status === 'archived') continue;

      const projectId = String(rows[i][0] || '').trim();
      const projectName = String(rows[i][1] || '').trim();
      const subject = String(rows[i][2] || '').trim();
      const maxCapacity = Number(rows[i][3]) || 0;
      const currentCount = Number(rows[i][4]) || 0;
      const leaderTelegramId = String(rows[i][5] || '').trim();
      const approvedMembers = String(rows[i][6] || '').trim();
      const deadline = String(rows[i][7] || '').trim();

      const membersList = approvedMembers ? approvedMembers.split(',').map(v => String(v).trim()).filter(Boolean) : [];

      result.push({
        projectId: projectId,
        projectName: projectName,
        subject: subject,
        maxCapacity: maxCapacity,
        currentCount: currentCount,
        leaderTelegramId: leaderTelegramId,
        approvedMembers: membersList,
        deadline: deadline,
        availableSpots: Math.max(0, maxCapacity - currentCount),
        status: status
      });
    }

    return result;
  } catch (error) {
    Logger.log('❌ Ошибка getProjectsForWebsite: ' + error.toString());
    return [];
  }
}

function handleWebsiteProjectRequest(data) {
  try {
    const name = String(data.name || '').trim();
    const subject = String(data.subject || '').trim();
    const maxCapacity = Number(data.maxCapacity || 0);
    const deadline = String(data.deadline || '').trim();
    const leaderTelegramId = String(data.leaderTelegramId || '').trim();

    if (!name || !subject || !leaderTelegramId) {
      Logger.log('⚠️ Некорректный запрос addProject');
      return;
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.projects);
    const projectId = 'PRJ-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

    sheet.appendRow([
      projectId,
      name,
      subject,
      maxCapacity,
      1,
      leaderTelegramId,
      leaderTelegramId,
      deadline,
      'Active'
    ]);

    sendTelegramMessage(
      leaderTelegramId,
      '✅ <b>Проект создан через сайт</b>\n\n' +
      'Название: <b>' + esc(name) + '</b>\n' +
      'ID: <b>' + projectId + '</b>'
    );
  } catch (error) {
    Logger.log('❌ Ошибка handleWebsiteProjectRequest: ' + error.toString());
  }
}

// ============================================================
// 6. Utility functions
// ============================================================

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setupWebhook() {
  try {
    const telegramApiUrl = 'https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(WEBHOOK_URL);
    const response = UrlFetchApp.fetch(telegramApiUrl, { muteHttpExceptions: true });
    Logger.log('🔗 Результат установки вебхука: ' + response.getContentText());
  } catch (error) {
    Logger.log('❌ Ошибка setupWebhook: ' + error.toString());
  }
}

function checkWebhookInfo() {
  try {
    const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo', { muteHttpExceptions: true });
    Logger.log('🔗 Webhook info: ' + response.getContentText());
  } catch (error) {
    Logger.log('❌ Ошибка checkWebhookInfo: ' + error.toString());
  }
}

function deleteWebhook() {
  try {
    const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/deleteWebhook?drop_pending_updates=true', { muteHttpExceptions: true });
    Logger.log('🗑️ deleteWebhook: ' + response.getContentText());
  } catch (error) {
    Logger.log('❌ Ошибка deleteWebhook: ' + error.toString());
  }
}

// ============================================================
// 7. Legacy helper functions for compatibility
// ============================================================

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheet(ss, SHEET_NAMES.projects, ['Project_ID', 'Project_Name', 'Subject', 'Max_Capacity', 'Current_Count', 'Leader_Telegram_ID', 'Approved_Members', 'Deadline', 'Status']);
  ensureSheet(ss, SHEET_NAMES.joinRequests, ['Request_ID', 'Project_ID', 'Student_Telegram_ID', 'Student_Name', 'Status']);
  ensureSheet(ss, SHEET_NAMES.adminIds, ['Telegram_ID']);
  ensureSheet(ss, SHEET_NAMES.homeworkPool, ['ID', 'Subject', 'Task_Description', 'Deadline_Date', 'Created_At', 'Status']);
  ensureSheet(ss, SHEET_NAMES.deadlines, ['Subject', 'Task', 'Date', 'Type', 'Credits', 'Points', 'Link']);
  ensureSheet(ss, SHEET_NAMES.schedule, ['Day', 'Time', 'Subject', 'Task', 'WeekType', 'Type']);
  ensureSheet(ss, SHEET_NAMES.groups, ['Group', 'Members']);
  ensureSheet(ss, SHEET_NAMES.syllabus, ['Subject', 'Theme']);
  ensureSheet(ss, SHEET_NAMES.studentProjects, ['Telegram_ID', 'Student_Name', 'Subject', 'Project_Name', 'Timestamp']);
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
}

function updateExpiredStatuses() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
  if (!projSheet) return;

  const rows = projSheet.getDataRange().getValues();
  if (rows.length < 2) return;

  const headers = rows[0].map(h => String(h).trim());
  const deadlineIndex = headers.indexOf('Deadline');
  let statusIndex = headers.indexOf('Status');

  if (statusIndex === -1) {
    statusIndex = headers.length;
    projSheet.getRange(1, statusIndex + 1).setValue('Status');
  }

  for (let i = 1; i < rows.length; i++) {
    const rowDate = String(rows[i][deadlineIndex] || '').trim();
    const currentStatus = String(rows[i][statusIndex] || '').trim();

    if (rowDate && rowDate < todayStr && currentStatus !== 'Expired' && currentStatus !== 'Archived') {
      projSheet.getRange(i + 1, statusIndex + 1).setValue('Expired');
    }
  }
}

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekTypeForDate(date) {
  const anchorMonday = getMondayOf(new Date(SCHEDULE_ANCHOR_MONDAY + 'T00:00:00'));
  const targetMonday = getMondayOf(date);
  const diffWeeks = Math.round((targetMonday - anchorMonday) / (7 * 24 * 60 * 60 * 1000));
  const parity = ((diffWeeks % 2) + 2) % 2;
  return parity === 0 ? SCHEDULE_ANCHOR_WEEK_TYPE : (SCHEDULE_ANCHOR_WEEK_TYPE === 1 ? 2 : 1);
}

function getTasksForDate(date) {
  const dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const dayName = DAY_NAMES[date.getDay()];
  const weekType = getWeekTypeForDate(date);
  const tasks = [];

  getSheetData(SHEET_NAMES.schedule).forEach(function (row) {
    const type = String(row.Type || '').toLowerCase();
    const isDeadlineType = type.indexOf('дедлайн') > -1 || type.indexOf('дз') > -1 || type.indexOf('deadline') > -1;
    if (!isDeadlineType) return;
    if (String(row.Day || '').trim() !== dayName) return;
    if (Number(row.WeekType) !== weekType) return;
    tasks.push({ subject: row.Subject || '', task: row.Task || '', due: dateStr });
  });

  getSheetData(SHEET_NAMES.homeworkPool).forEach(function (row) {
    if (String(row.Deadline_Date || '').trim() === dateStr) {
      tasks.push({ subject: row.Subject || '', task: row.Task_Description || '', due: dateStr });
    }
  });

  return tasks;
}

function checkAndSend3DayReminders() {
  const target = new Date();
  target.setDate(target.getDate() + 3);
  const tasks = getTasksForDate(target);

  if (!tasks.length) return;

  let message = '⏰ <b>Напоминание: через 3 дня:</b>\n\n';
  tasks.forEach(function (task, index) {
    message += (index + 1) + '. <b>[' + esc(task.subject) + ']</b>: ' + esc(task.task) + ' (' + task.due + ')\n';
  });

  sendTelegramMessage(CHAT_ID, message);
}

function firstValue(namedValues, keys) {
  for (let i = 0; i < keys.length; i++) {
    if (namedValues[keys[i]] && namedValues[keys[i]][0]) {
      return namedValues[keys[i]][0];
    }
  }
  return '';
}

function onSpreadsheetFormSubmit(e) {
  if (!e || !e.range) return;

  const sheetName = e.range.getSheet().getName();
  const lock = LockService.getScriptLock();

  if (lock.tryLock(10000)) {
    try {
      if (sheetName === CONFIG.SHEETS.RESPONSES_DEADLINES || sheetName.includes('Ответы на форму 1')) {
        processDeadlineSubmission(e);
      } else if (sheetName === CONFIG.SHEETS.RESPONSES_PROJECTS || sheetName.includes('Ответы на форму 2')) {
        processTeamSubmission(e);
      }
    } catch (error) {
      Logger.log('❌ Ошибка onSpreadsheetFormSubmit: ' + error.toString());
    } finally {
      lock.releaseLock();
    }
  }
}

function processDeadlineSubmission(e) {
  const values = e.values;
  if (!values || values.length < 4) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.DEADLINES);
  if (!sheet) return;

  let formattedDate = values[3];
  if (values[3]) {
    const parsed = new Date(values[3]);
    if (!isNaN(parsed.getTime())) {
      formattedDate = Utilities.formatDate(parsed, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    }
  }

  sheet.appendRow([values[1], values[2], formattedDate, values[4] || 'Дедлайн', values[5], values[6], values[7]]);
}

function processTeamSubmission(e) {
  const values = e.values;
  if (!values || values.length < 4) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const projectsSheet = ss.getSheetByName(CONFIG.SHEETS.PROJECTS);
  const studentProjectsSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENT_PROJECTS);

  const leaderName = String(values[1] || '').trim();
  const subject = String(values[2] || '').trim();
  const projectName = String(values[3] || '').trim();

  const applicants = [leaderName, values[4], values[5], values[6]]
    .map(v => String(v || '').trim())
    .filter(v => v.length > 0);

  if (!projectName || applicants.length === 0) return;

  const projectsData = projectsSheet.getDataRange().getValues();
  let projectRow = -1;
  let maxCap = 0;
  let curCount = 0;

  for (let i = 1; i < projectsData.length; i++) {
    if (String(projectsData[i][1]).trim() === projectName) {
      projectRow = i + 1;
      maxCap = Number(projectsData[i][3]) || 0;
      curCount = Number(projectsData[i][4]) || 0;
      break;
    }
  }

  if (projectRow === -1) return;

  const freeSpace = maxCap - curCount;
  if (freeSpace > 0) {
    const accepted = applicants.slice(0, freeSpace);
    const now = new Date().toISOString();

    accepted.forEach(student => {
      studentProjectsSheet.appendRow(['', student, subject, projectName, now]);
    });

    const newCount = curCount + accepted.length;
    projectsSheet.getRange(projectRow, 5).setValue(newCount);
  }
}

// ============================================================
// 8. Maintainers / compatibility constants
// ============================================================

const TEAM_FORM_ID = '1PCasYaKY3YepLZrwjBA272-kUZa4bDlVGThxP4mZ1b4';
const PROJECT_QUESTION_TITLE = 'Выберите проект';

function updateFormProjectOptions() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const projSheet = ss.getSheetByName('Projects');
    if (!projSheet) return;

    const data = projSheet.getDataRange().getValues();
    if (data.length < 2) return;

    const activeProjects = [];
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][1]).trim();
      const maxCap = Number(data[i][3]) || 0;
      const curCount = Number(data[i][4]) || 0;
      const status = String(data[i][8] || 'Active').trim();

      if (name && status === 'Active' && curCount < maxCap) {
        activeProjects.push(name);
      }
    }

    const form = FormApp.openById(TEAM_FORM_ID);
    const items = form.getItems();

    for (let i = 0; i < items.length; i++) {
      if (items[i].getTitle() === PROJECT_QUESTION_TITLE) {
        const listItem = items[i].asListItem();
        if (activeProjects.length > 0) {
          listItem.setChoiceValues(activeProjects);
        } else {
          listItem.setChoiceValues(['Нет доступных проектов']);
        }
        break;
      }
    }
  } catch (error) {
    Logger.log('❌ Ошибка updateFormProjectOptions: ' + error.toString());
  }
}

// ============================================================
// End of file
// ============================================================
