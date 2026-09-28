// ============================================================
// CLASS HUB — Google Apps Script (Telegram + Google Forms + Sheets)
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
  studentProjects: 'Student_Projects',
  responses: 'Form Responses 1'
};

const FORM_TITLES = {
  adminForm: 'Админская форма проекта',
  studentForm: 'Создать команду проекта',
  joinRequestForm: 'Заявка на вступление в команду'
};

const CONFIG = {
  TEAM_FORM_ID: '1PCasYaKY3YepLZrwjBA272-kUZa4bDlVGThxP4mZ1b4',
  PROJECT_QUESTION_TITLE: 'Выберите проект',
  SHEETS: {
    DEADLINES: 'Deadlines',
    PROJECTS: 'Projects',
    STUDENT_PROJECTS: 'Student_Projects',
    RESPONSES_DEADLINES: 'Form Responses 1',
    RESPONSES_PROJECTS: 'Form Responses 2'
  }
};

// ============================================================
// 1. WEBHOOK / doPost / doGet
// ============================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('⚠️ Пустой POST запрос');
      return HtmlService.createHtmlOutput('No data');
    }

    const data = JSON.parse(e.postData.contents);

    // 1. Обработка Telegram webhook
    if (data.message) {
      handleTextMessage(data.message);
      return HtmlService.createHtmlOutput('OK');
    } 
    if (data.callback_query) {
      handleTelegramCallbackQuery(data.callback_query);
      return HtmlService.createHtmlOutput('OK');
    } 

    // 2. Обработка заявок с сайта
    if (data.action === 'joinProjectRequest') {
      handleJoinRequestSubmission({
        project_id: data.projectId,
        student_tg: data.studentId,
        student_name: data.studentName
      });
      return createJsonResponse({ status: 'success', message: 'Заявка отправлена' });
    }

    if (data.action === 'addProject') {
      handleWebsiteProjectRequest(data);
      return createJsonResponse({ status: 'success' });
    }

    if (data.action === 'sync') {
      recalculateProjectCounts();
      updateFormProjectOptions();
      return createJsonResponse({ status: 'success', message: 'Синхронизация выполнена' });
    }

    return HtmlService.createHtmlOutput('OK');
  } catch (error) {
    Logger.log('❌ Ошибка doPost: ' + error.toString());
    return HtmlService.createHtmlOutput('ERROR');
  }
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getAll';

    // Запрос конкретной вкладки
    if (action === 'getProjects') {
      return createJsonResponse({ status: 'success', data: getProjectsForWebsite() });
    }
    if (action === 'getDeadlines') {
      return createJsonResponse({ status: 'success', data: getDeadlinesForWebsite() });
    }
    if (action === 'getSyllabus') {
      return createJsonResponse({ status: 'success', data: getSheetData(SHEET_NAMES.syllabus) });
    }

    // По умолчанию возвращаем ВСЕ данные одновременно для всех вкладок сайта
    return createJsonResponse({
      status: 'success',
      projects: getProjectsForWebsite(),
      deadlines: getDeadlinesForWebsite(),
      syllabus: getSheetData(SHEET_NAMES.syllabus)
    });

  } catch (err) {
    return createJsonResponse({ status: 'error', error: err.toString() });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 2. Telegram message & Callback handlers
// ============================================================

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
      sendTelegramMessage(message.chat.id, '❌ Произошла ошибка при обработке запроса.');
    }
  }
}

function handleTelegramCallbackQuery(callbackQuery) {
  try {
    if (!callbackQuery || !callbackQuery.data) return;

    const callbackId = callbackQuery.id;
    const userId = String(callbackQuery.from && callbackQuery.from.id || '');
    const data = callbackQuery.data;

    if (data.indexOf('app_') === 0) {
      handleApproveRequest(data.replace(/^app_/, ''), userId, callbackId);
      return;
    }

    if (data.indexOf('rej_') === 0) {
      handleRejectRequest(data.replace(/^rej_/, ''), userId, callbackId);
      return;
    }

    answerCallbackQuery(callbackId, 'Неизвестное действие', true);
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

      for (let i = 1; i < joinData.length; i++) {
        if (String(joinData[i][0]).trim() === String(requestId).trim()) {
          requestRow = i;
          projectId = String(joinData[i][1] || '').trim();
          studentTelegramId = String(joinData[i][2] || '').trim();
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
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    Logger.log('❌ Ошибка handleApproveRequest: ' + error.toString());
    answerCallbackQuery(callbackId, 'Ошибка при подтверждении', true);
  }
}

function handleRejectRequest(requestId, userId, callbackId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      answerCallbackQuery(callbackId, 'Операция занята.', true);
      return;
    }

    try {
      const joinSheet = ss.getSheetByName(SHEET_NAMES.joinRequests);
      const projectsSheet = ss.getSheetByName(SHEET_NAMES.projects);

      if (!joinSheet || !projectsSheet) {
        answerCallbackQuery(callbackId, 'Таблицы не найдены.', true);
        return;
      }

      const joinData = joinSheet.getDataRange().getValues();
      const projectsData = projectsSheet.getDataRange().getValues();

      let requestRow = -1;
      let projectId = '';
      let studentTelegramId = '';

      for (let i = 1; i < joinData.length; i++) {
        if (String(joinData[i][0]).trim() === String(requestId).trim()) {
          requestRow = i;
          projectId = String(joinData[i][1] || '').trim();
          studentTelegramId = String(joinData[i][2] || '').trim();
          break;
        }
      }

      if (requestRow === -1) {
        answerCallbackQuery(callbackId, 'Заявка не найдена.', true);
        return;
      }

      let leaderTelegramId = '';
      let projectName = '';

      for (let i = 1; i < projectsData.length; i++) {
        if (String(projectsData[i][0]).trim() === String(projectId).trim()) {
          leaderTelegramId = String(projectsData[i][5] || '').trim();
          projectName = String(projectsData[i][1] || '').trim();
          break;
        }
      }

      if (String(leaderTelegramId) !== String(userId)) {
        answerCallbackQuery(callbackId, 'У вас нет права отклонять эту заявку.', true);
        return;
      }

      joinSheet.getRange(requestRow + 1, 5).setValue('Rejected');

      sendTelegramMessage(
        studentTelegramId,
        '❌ <b>Ваша заявка отклонена</b>\n\n' +
        'Проект: <b>' + esc(projectName) + '</b>'
      );

      answerCallbackQuery(callbackId, '✅ Заявка отклонена', false);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    Logger.log('❌ Ошибка handleRejectRequest: ' + error.toString());
    answerCallbackQuery(callbackId, 'Ошибка при отклонении', true);
  }
}

// ============================================================
// 3. Google Forms & Sheets triggers
// ============================================================

// ============================================================
// ОБРАБОТКА И ПЕРЕНОС ДЗ В DEADLINES И HOMEWORK_POOL
// ============================================================

function onFormSubmit(e) {
  try {
    if (!e) return;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return;

    try {
      const sheetName = (e.range && e.range.getSheet) ? e.range.getSheet().getName() : '';
      const answers = parseFormAnswers(e);

      // 1. Форма ДЗ
      if (sheetName === 'ADD HW' || sheetName.includes('HW') || answers.isHomework) {
        handleHomeworkSubmission(answers);
      } 
      // 2. Форма подачи заявки в команду (Team / Join_Requests)
      else if (sheetName === 'Team' || sheetName.includes('Team') || answers.isJoinRequest) {
        handleJoinRequestSubmission(answers);
      } 
      // 3. Форма создания нового проекта
      else if (sheetName === 'Проекты' || sheetName.includes('Проект')) {
        handleProjectCreationSubmission(answers, sheetName);
      }

      recalculateProjectCounts();
      updateFormProjectOptions();
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('❌ Ошибка в onFormSubmit: ' + err.toString());
    logErrorToSheet('onFormSubmit', err.toString());
  }
}

function parseFormAnswers(e) {
  const result = {
    project_name: '', subject: '', max_capacity: '', leader_tg: '',
    deadline: '', project_id: '', student_tg: '', student_name: '',
    task: '', points: '', link: '', isJoinRequest: false, isHomework: false
  };

  if (!e || !e.namedValues) return result;

  const sheetName = (e.range && e.range.getSheet) ? e.range.getSheet().getName() : '';

  Object.keys(e.namedValues).forEach(key => {
    const k = key.toLowerCase().trim();
    const val = String(e.namedValues[key][0] || '').trim();

    if (k.includes('предмет') || k.includes('дисциплина')) result.subject = val;
    if (k.includes('задание') || k.includes('описание')) result.task = val;
    if (k.includes('срок') || k.includes('дата') || k.includes('дедлайн')) result.deadline = val;
    if (k.includes('балл') || k.includes('кредит')) result.points = val;
    if (k.includes('ссылка') || k.includes('материал')) result.link = val;
    if (k.includes('мест') || k.includes('capacity')) result.max_capacity = val;

    // Чтение Telegram username / ID
    if (k.includes('telegram') || k.includes('username') || k.includes('логин') || k.includes('юзернейм')) {
      const cleanTg = val.replace('@', '').trim();
      if (sheetName === 'Team' || k.includes('студент') || k.includes('участник')) {
        result.student_tg = cleanTg;
      } else {
        result.leader_tg = cleanTg;
      }
    }

    if (k.includes('имя') || k.includes('фио') || k.includes('ф.и.о')) result.student_name = val;

    // Определение выбранного проекта
    if (k.includes('выберите проект') || k.includes('проект')) {
      if (val.includes('PRJ-')) {
        const match = val.match(/(PRJ-\d+)/i);
        if (match) {
          result.project_id = match[1].toUpperCase();
        }
      }
      result.project_name = val;
    }
  });

  if (sheetName === 'Team' || result.project_id) {
    result.isJoinRequest = true;
  }
  if (sheetName === 'ADD HW' || result.task) {
    result.isHomework = true;
  }

  return result;
}

function handleHomeworkSubmission(answers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // 1. Запись в Deadlines (Subject, Task, Date, Points, Link)
  const deadlinesSheet = ss.getSheetByName(SHEET_NAMES.deadlines);
  if (deadlinesSheet) {
    deadlinesSheet.appendRow([
      answers.subject,
      answers.task,
      answers.deadline,
      answers.points,
      answers.link
    ]);
  }

  // 2. Запись в Homework_Pool (ID, Subject, Task_Description, Deadline_Date, Created_At)
  const hwPoolSheet = ss.getSheetByName(SHEET_NAMES.homeworkPool);
  if (hwPoolSheet) {
    const hwId = 'HW-' + String(hwPoolSheet.getLastRow()).padStart(3, '0');
    const createdAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    hwPoolSheet.appendRow([
      hwId,
      answers.subject,
      answers.task,
      answers.deadline,
      createdAt
    ]);
  }
}

// Разовый перенос уже имеющихся ответов из формы
function syncExistingHomeworkResponses() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Ищем именно вкладку ADD HW
  let formSheet = ss.getSheetByName('ADD HW');
  if (!formSheet) {
    const sheets = ss.getSheets();
    for (let s of sheets) {
      const val = s.getRange(1, 1, 1, Math.min(10, s.getLastColumn())).getValues()[0];
      const headersStr = val.join(' ').toLowerCase();
      if (headersStr.includes('задание')) {
        formSheet = s;
        break;
      }
    }
  }

  if (!formSheet) {
    Logger.log('❌ Вкладка с ответами формы ДЗ не найдена!');
    return;
  }

  const data = formSheet.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0].map(h => String(h).toLowerCase().trim());

  let idxSubject = headers.findIndex(h => h.includes('предмет'));
  if (idxSubject === -1) idxSubject = 1;

  let idxTask = headers.findIndex(h => h.includes('задание') || h.includes('описание'));
  if (idxTask === -1) idxTask = 2;

  let idxDate = headers.findIndex(h => h.includes('срок') || h.includes('дата') || h.includes('дедлайн'));
  if (idxDate === -1) idxDate = 3;

  let idxPoints = headers.findIndex(h => h.includes('балл') || h.includes('кредит'));
  if (idxPoints === -1) idxPoints = 4;

  let idxLink = headers.findIndex(h => h.includes('ссылка') || h.includes('материал'));
  if (idxLink === -1) idxLink = 5;

  const deadlinesSheet = ss.getSheetByName(SHEET_NAMES.deadlines);
  const hwPoolSheet = ss.getSheetByName(SHEET_NAMES.homeworkPool);

  // Очищаем старые неполные строки (оставляем заголовки)
  if (deadlinesSheet && deadlinesSheet.getLastRow() > 1) {
    deadlinesSheet.getRange(2, 1, deadlinesSheet.getLastRow() - 1, deadlinesSheet.getLastColumn()).clearContent();
  }
  if (hwPoolSheet && hwPoolSheet.getLastRow() > 1) {
    hwPoolSheet.getRange(2, 1, hwPoolSheet.getLastRow() - 1, hwPoolSheet.getLastColumn()).clearContent();
  }

  // Заполняем таблицы правильными данными
  let hwCounter = 1;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const subject = String(row[idxSubject] || '').trim();
    const task = String(row[idxTask] || '').trim();
    
    let date = row[idxDate];
    if (date instanceof Date) {
      date = Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd.MM.yyyy');
    } else {
      date = String(date || '').trim();
    }

    const points = String(row[idxPoints] || '').trim();
    const link = String(row[idxLink] || '').trim();
    
    let createdAt = row[0];
    if (createdAt instanceof Date) {
      createdAt = Utilities.formatDate(createdAt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    } else {
      createdAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    }

    if (!subject && !task) continue;

    // Deadlines (Subject, Task, Date, Points, Link)
    if (deadlinesSheet) {
      deadlinesSheet.appendRow([subject, task, date, points, link]);
    }

    // Homework_Pool (ID, Subject, Task_Description, Deadline_Date, Created_At)
    if (hwPoolSheet) {
      const hwId = 'HW-' + String(hwCounter++).padStart(3, '0');
      hwPoolSheet.appendRow([hwId, subject, task, date, createdAt]);
    }
  }
}

function handleProjectCreationSubmission(answers, sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetProjects = ss.getSheetByName(SHEET_NAMES.projects);
  if (!sheetProjects) throw new Error('Лист "Projects" не найден!');

  const projectId = generateNextProjectId(sheetProjects);

  const newRow = [
    projectId,
    answers.project_name,
    answers.subject || '—',
    Number(answers.max_capacity) || 4,
    1,
    answers.leader_tg || 'ADMIN',
    answers.leader_tg || 'ADMIN',
    answers.deadline || '30.12.2026',
    'Active'
  ];

  sheetProjects.appendRow(newRow);
}

function handleJoinRequestSubmission(answers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const projectsSheet = ss.getSheetByName(SHEET_NAMES.projects || 'Projects');
  
  let matchedDeadline = '';
  let matchedProjectName = answers.project_name;
  let targetProjectId = answers.project_id;

  // Ищем дедлайн и название проекта в листе Projects
  if (projectsSheet) {
    const data = projectsSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowProjId = String(data[i][0]).trim().toUpperCase();
      const rowProjName = String(data[i][1]).trim();
      
      if ((targetProjectId && rowProjId === targetProjectId) || 
          (answers.project_name && answers.project_name.includes(rowProjId))) {
        targetProjectId = rowProjId;
        matchedProjectName = rowProjName;
        matchedDeadline = data[i][7]; // Столбец H (Deadline)
        if (matchedDeadline instanceof Date) {
          matchedDeadline = Utilities.formatDate(matchedDeadline, Session.getScriptTimeZone(), 'dd.MM.yyyy');
        }
        break;
      }
    }
  }

  // Записываем данные в Join_Requests
  const joinSheet = ss.getSheetByName(SHEET_NAMES.joinRequests || 'Join_Requests');
  if (joinSheet) {
    const reqId = 'REQ-' + String(joinSheet.getLastRow()).padStart(3, '0');
    const createdAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const studentTg = answers.student_tg || answers.leader_tg;

    joinSheet.appendRow([
      reqId,
      targetProjectId,
      matchedProjectName,
      answers.student_name || 'Участник',
      studentTg,
      'Pending',
      createdAt,
      matchedDeadline // Дедлайн подтягивается автоматически из Projects
    ]);
  }
}

function notifyLeaderAboutRequest(projectId, requestId, studentTg, studentName) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetProjects = ss.getSheetByName(SHEET_NAMES.projects);
    const data = sheetProjects.getDataRange().getValues();

    let leaderId = null;
    let projectName = projectId;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(projectId).trim()) {
        projectName = data[i][1];
        leaderId = data[i][5];
        break;
      }
    }

    if (!leaderId || leaderId === 'ADMIN') return;

    const message = `📥 <b>Новая заявка в вашу команду!</b>\n\n` +
                    `📌 <b>Проект:</b> ${projectName} (${projectId})\n` +
                    `👤 <b>Заявитель:</b> ${studentName} (ID: <code>${studentTg}</code>)\n\n` +
                    `Принять студента в команду?`;

    const buttons = [
      { text: "✅ Принять", callback_data: "app_" + requestId },
      { text: "❌ Отклонить", callback_data: "rej_" + requestId }
    ];

    sendTelegramMessageWithButtons(leaderId, message, [buttons]);
  } catch (err) {
    Logger.log('❌ Ошибка отправки уведомления лидеру: ' + err.toString());
  }
}

function onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() === SHEET_NAMES.projects) {
      recalculateProjectCounts();
      updateFormProjectOptions();
    }
  } catch (error) {
    Logger.log('❌ Ошибка в onSheetEdit: ' + error.toString());
  }
}

// ============================================================
// 4. Data Processing Helpers
// ============================================================

function parseFormAnswers(e) {
  const result = {
    project_name: '', subject: '', max_capacity: '', leader_tg: '',
    deadline: '', project_id: '', student_tg: '', student_name: ''
  };

  if (!e || !e.namedValues) return result;

  Object.keys(e.namedValues).forEach(key => {
    const k = key.toLowerCase().trim();
    const val = String(e.namedValues[key][0] || '').trim();

    if (k.includes('название') || k.includes('проект')) result.project_name = val;
    if (k.includes('предмет') || k.includes('дисциплина')) result.subject = val;
    if (k.includes('мест') || k.includes('capacity')) result.max_capacity = val;
    if (k.includes('лидер') || (k.includes('telegram') && !k.includes('студент'))) result.leader_tg = val.replace('@', '');
    if (k.includes('дедлайн') || k.includes('срок')) result.deadline = val;
    if (k.includes('код проекта') || k.includes('prj-')) result.project_id = val.toUpperCase();
    if (k.includes('ваш telegram') || k.includes('id студента')) result.student_tg = val.replace('@', '');
    if (k.includes('имя') || k.includes('фио')) result.student_name = val;
  });

  return result;
}

function generateNextProjectId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 'PRJ-001';

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let maxNum = 0;

  ids.forEach(row => {
    const match = String(row[0]).match(/PRJ-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  return 'PRJ-' + String(maxNum + 1).padStart(3, '0');
}

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

function getDeadlinesForWebsite() {
  let deadlines = getSheetData(SHEET_NAMES.deadlines);
  if (!deadlines || deadlines.length === 0) {
    deadlines = getSheetData(SHEET_NAMES.homeworkPool);
  }
  return deadlines;
}

function getProjectsForWebsite() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const projectsSheet = ss.getSheetByName(SHEET_NAMES.projects);
    if (!projectsSheet) return [];

    const rows = projectsSheet.getDataRange().getValues();
    const result = [];

    for (let i = 1; i < rows.length; i++) {
      const status = String(rows[i][8] || 'Active').trim().toLowerCase();
      if (status === 'closed' || status === 'expired' || status === 'archived' || status === 'inactive') continue;

      const maxCapacity = Number(rows[i][3]) || 0;
      const currentCount = Number(rows[i][4]) || 0;

      result.push({
        projectId: String(rows[i][0] || '').trim(),
        projectName: String(rows[i][1] || '').trim(),
        subject: String(rows[i][2] || '').trim(),
        maxCapacity: maxCapacity,
        currentCount: currentCount,
        leaderTelegramId: String(rows[i][5] || '').trim(),
        approvedMembers: String(rows[i][6] || '').trim(),
        deadline: String(rows[i][7] || '').trim(),
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

function processUserQuery(userMessage) {
  try {
    const query = String(userMessage || '').trim();
    if (!query) return '❓ Напишите вопрос, например: «Что задавали по математике?»';

    const normalized = query.toLowerCase();

    if (normalized.includes('проект') || normalized.includes('команда') || normalized.includes('группа')) {
      return findProjectsForTelegram();
    }
    if (normalized.includes('расписан') || normalized.includes('занят') || normalized.includes('когда')) {
      return findScheduleForTelegram();
    }
    if (
      normalized.includes('дз') || normalized.includes('домаш') ||
      normalized.includes('задан') || normalized.includes('дедлайн') || normalized.includes('по ')
    ) {
      return findHomeworkForTelegram(query);
    }

    return '❓ Я не понял ваш вопрос. Попробуйте: «Что задавали по математике?» или «Какие проекты есть?»';
  } catch (error) {
    Logger.log('❌ Ошибка processUserQuery: ' + error.toString());
    return '❌ Не удалось обработать запрос.';
  }
}

function findHomeworkForTelegram(query) {
  try {
    const subject = extractSubjectFromQuery(query);
    const rows = [];

    const hwRows = getSheetData(SHEET_NAMES.homeworkPool);
    hwRows.forEach(row => {
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
      return subject
        ? '📋 По предмету «' + esc(subject) + '» заданий не найдено.'
        : '📋 Заданий пока не найдено.';
    }

    let result = '📚 <b>Найдены задания:</b>\n\n';
    rows.slice(0, 10).forEach((r, index) => {
      result += (index + 1) + '. <b>[' + esc(r.subject || 'Без предмета') + ']</b>: ' + esc(r.task || 'Без текста');
      if (r.date) result += ' — <i>' + esc(r.date) + '</i>';
      result += '\n';
    });

    return result;
  } catch (error) {
    return '❌ Не удалось прочитать данные из таблицы.';
  }
}

function findScheduleForTelegram() {
  try {
    const rows = getSheetData(SHEET_NAMES.schedule);
    if (!rows.length) return '📅 Расписание пока не найдено.';

    let result = '📅 <b>Расписание:</b>\n\n';
    rows.slice(0, 15).forEach((r, index) => {
      result += (index + 1) + '. <b>' + esc(r.Day || 'День') + '</b> — ' + esc(r.Subject || 'Предмет') + ' (' + esc(r.Time || 'Время') + ')\n';
    });

    return result;
  } catch (error) {
    return '❌ Не удалось прочитать расписание.';
  }
}

function findProjectsForTelegram() {
  try {
    const rows = getSheetData(SHEET_NAMES.projects).filter(row => {
      const status = String(row.Status || 'Active').trim().toLowerCase();
      return status !== 'expired' && status !== 'archived' && status !== 'closed';
    });

    if (!rows.length) return '📦 Активных проектов пока нет.';

    let result = '📦 <b>Активные проекты:</b>\n\n';
    rows.slice(0, 10).forEach((row, index) => {
      const currentCount = Number(row.Current_Count) || 0;
      const maxCapacity = Number(row.Max_Capacity) || 0;
      const freePlaces = Math.max(0, maxCapacity - currentCount);
      result += (index + 1) + '. <b>' + esc(row.Project_Name || 'Без названия') + '</b>\n';
      result += '   📚 ' + esc(row.Subject || 'Предмет') + '\n';
      result += '   👥 Свободно: ' + freePlaces + '/' + maxCapacity + '\n\n';
    });

    return result;
  } catch (error) {
    return '❌ Не удалось прочитать проекты.';
  }
}

function extractSubjectFromQuery(query) {
  try {
    const text = String(query || '').toLowerCase();
    const match = text.match(/по\s+([а-яёa-z0-9\-_ ]+)/i);
    if (!match) return '';
    return match[1].trim().replace(/\s+(что|задали|задавали|домашка|дз|сегодня|сейчас)$/i, '');
  } catch (error) {
    return '';
  }
}

// ============================================================
// 5. External Integration & Recalculations
// ============================================================

function recalculateProjectCounts() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
    const reqSheet = ss.getSheetByName(SHEET_NAMES.joinRequests);

    if (!projSheet || !reqSheet) return;

    const projData = projSheet.getDataRange().getValues();
    const reqData = reqSheet.getDataRange().getValues();

    if (projData.length < 2) return;

    const counts = {};
    for (let i = 1; i < reqData.length; i++) {
      const pId = String(reqData[i][1] || '').trim();
      const status = String(reqData[i][4] || '').trim();
      if (pId && status === 'Approved') {
        counts[pId] = (counts[pId] || 0) + 1;
      }
    }

    for (let i = 1; i < projData.length; i++) {
      const pId = String(projData[i][0]).trim();
      if (pId) {
        const approvedCount = (counts[pId] || 0) + 1; // +1 лидер
        projSheet.getRange(i + 1, 5).setValue(approvedCount);
      }
    }

    SpreadsheetApp.flush();
  } catch (error) {
    Logger.log('❌ Ошибка в recalculateProjectCounts: ' + error.toString());
  }
}

function updateFormProjectOptions() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
    if (!projSheet) return;

    const data = projSheet.getDataRange().getValues();
    if (data.length < 2) return;

    const activeProjects = [];
    for (let i = 1; i < data.length; i++) {
      const pId = String(data[i][0]).trim();
      const name = String(data[i][1]).trim();
      const maxCap = Number(data[i][3]) || 0;
      const curCount = Number(data[i][4]) || 0;
      const status = String(data[i][8] || 'Active').trim();

      if (name && status === 'Active' && curCount < maxCap) {
        activeProjects.push(`${name} (${pId})`);
      }
    }

    const form = FormApp.openById(CONFIG.TEAM_FORM_ID);
    const items = form.getItems();

    for (let i = 0; i < items.length; i++) {
      if (items[i].getTitle() === CONFIG.PROJECT_QUESTION_TITLE) {
        const listItem = items[i].asListItem();
        listItem.setChoiceValues(activeProjects.length > 0 ? activeProjects : ['Нет доступных проектов']);
        break;
      }
    }
  } catch (error) {
    Logger.log('❌ Ошибка updateFormProjectOptions: ' + error.toString());
  }
}

function handleWebsiteProjectRequest(data) {
  try {
    const name = String(data.name || '').trim();
    const subject = String(data.subject || '').trim();
    const maxCapacity = Number(data.maxCapacity || 0);
    const deadline = String(data.deadline || '').trim();
    const leaderTelegramId = String(data.leaderTelegramId || '').trim();

    if (!name || !subject || !leaderTelegramId) return;

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.projects);
    const projectId = 'PRJ-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

    sheet.appendRow([
      projectId, name, subject, maxCapacity, 1,
      leaderTelegramId, leaderTelegramId, deadline, 'Active'
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
// 6. Telegram API & Setup Utilities
// ============================================================

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sendTelegramMessage(chatId, text) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: String(chatId), text: text, parse_mode: 'HTML' }),
    muteHttpExceptions: true
  });
}

function sendTelegramMessageWithButtons(chatId, text, buttons) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: String(chatId),
      text: text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons }
    }),
    muteHttpExceptions: true
  });
}

function answerCallbackQuery(callbackId, text, showAlert) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ callback_query_id: callbackId, text: text, show_alert: !!showAlert }),
    muteHttpExceptions: true
  });
}

function logErrorToSheet(functionName, errorMessage) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let logSheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
    logSheet.appendRow([new Date(), functionName, errorMessage]);
  } catch (e) {
    Logger.log('Ошибка записи лога: ' + e.toString());
  }
}

function setupAllTriggers() {
  clearAllTriggers();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('updateFormProjectOptions').timeBased().everyHours(1).create();

  setupWebhook();
}

function clearAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}

function setupWebhook() {
  try {
    const telegramApiUrl = 'https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(WEBHOOK_URL);
    const response = UrlFetchApp.fetch(telegramApiUrl, { muteHttpExceptions: true });
    Logger.log('🔗 Вебхук установлен: ' + response.getContentText());
  } catch (error) {
    Logger.log('❌ Ошибка setupWebhook: ' + error.toString());
  }
}
