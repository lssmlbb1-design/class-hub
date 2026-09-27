// === CONFIG ===
const BOT_TOKEN = '8727223928:AAHCu-jJhFWmyqY4r0iUPWOJD445SbZNa9o';
const GEMINI_API_KEY = 'AQ.Ab8RN6LXnqN9L-Lj1V_ltNLKsrbs_CCmKaQas3CnXXl3L9FirQ';

const CHAT_ID = '-1004379161096';   // your supergroup ID (starts with -100)
const TOPIC_ID = 3;                 // fallback topic (e.g. "Deadlines") when a message has no thread id
const WEB_APP_TELEGRAM_LINK = 'https://lssmlbb1-design.github.io/class-hub/';

const SPREADSHEET_ID = '1ygTKJmW_9GWwPspc1RY2yJjvfI8WT5XsFf2NNZuAT_M';

// Your deployed /exec URL, used only by setupWebhook() below.
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzLu1rrwQDBCzMzyW3XnFfFA1GsGWY715qEJ3_oe-MKwHl3t4NKWSiFFENyPHTblP2PgQ/exec';

// Optional shared secret appended to the webhook URL as ?token=...
const WEBHOOK_SECRET = '1234899384';

const SCHEDULE_ANCHOR_MONDAY = '2026-09-07';
const SCHEDULE_ANCHOR_WEEK_TYPE = 1;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Единый справочник названий листов
const SHEET_NAMES = {
  deadlines: 'Deadlines',
  groups: 'Groups',
  syllabus: 'Syllabus',
  projects: 'Projects',
  studentProjects: 'Student_Projects',
  homeworkPool: 'Homework_Pool',

  // Legacy: используется только getTasksForDate()/checkAndSend3DayReminders()
  // для бинедельного расписания (Day/WeekType). Не удалять.
  schedule: 'Schedule'
};
const CONFIG = {
  TEAM_FORM_ID: '1ygTKJmW_9GWwPspc1RY2yJjvfI8WT5XsFf2NNZuAT_M', // Замените на реальный ID
  SHEETS: {
    DEADLINES: 'Deadlines',
    PROJECTS: 'Projects',
    STUDENT_PROJECTS: 'Student_Projects',
    RESPONSES_DEADLINES: 'Form Responses 1', // или 'Ответы на форму 1'
    RESPONSES_PROJECTS: 'Form Responses 2'   // или 'Ответы на форму 2'
  }
};

// ============================================================
// One-time setup: Проверка и создание структуры без очистки
// ============================================================
function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheet(ss, SHEET_NAMES.deadlines, ['Subject', 'Task', 'Date', 'Type', 'Credits', 'Points', 'Link']);
  ensureSheet(ss, SHEET_NAMES.projects, ['Project_ID', 'Project_Name', 'Subject', 'Max_Capacity', 'Current_Count', 'Deadline', 'Telegram_Msg_Link', 'Status']);
  ensureSheet(ss, SHEET_NAMES.studentProjects, ['Telegram_ID', 'Student_Name', 'Subject', 'Project_Name', 'Timestamp']);
  ensureSheet(ss, SHEET_NAMES.homeworkPool, ['ID', 'Subject', 'Task_Description', 'Deadline_Date', 'Created_At', 'Status']);
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    Logger.log('Created sheet: ' + name);
  }
}

// ============================================================
// doGet — API для Mini App / Сайта
// ============================================================

function doGet(e) {
  try {
    updateExpiredStatuses();

    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    let payload;
    
    switch (action) {
      case 'getDeadlines': 
      case 'getSchedule': 
        payload = { schedule: getSheetData(SHEET_NAMES.deadlines) }; 
        break;
      case 'getGroups': 
        payload = { groups: getSheetData(SHEET_NAMES.groups) }; 
        break;
      case 'getSyllabus': 
        payload = { syllabus: getSheetData(SHEET_NAMES.syllabus) }; 
        break;
      case 'getProjects': 
        payload = { projects: getSheetData(SHEET_NAMES.projects).filter(p => p.Status !== 'Expired' && p.Status !== 'Archived') }; 
        break;
      case 'getProjectsWithStudents': {
        const projects = getSheetData(SHEET_NAMES.projects);
        const students = getSheetData(SHEET_NAMES.studentProjects);
        
        const result = projects.map(p => {
          const members = students
            .filter(s => String(s.Project_Name).trim().toLowerCase() === String(p.Project_Name).trim().toLowerCase())
            .map(s => s.Student_Name);
          return {
            id: p.Project_ID,
            subject: p.Subject,
            name: p.Project_Name,
            deadline: p.Deadline,
            maxCapacity: Number(p.Max_Capacity) || 0,
            currentCount: members.length,
            telegramLink: p.Telegram_Msg_Link || '',
            status: p.Status || 'Active',
            members: members
          };
        });
        payload = { projects: result };
        break;
      }
      case 'getAll': {
        const deadlines = getSheetData(SHEET_NAMES.deadlines);
        payload = {
          deadlines: deadlines,
          schedule: deadlines,
          groups: getSheetData(SHEET_NAMES.groups),
          syllabus: getSheetData(SHEET_NAMES.syllabus),
          projects: getSheetData(SHEET_NAMES.projects)
        };
        break;
      }
      default: payload = { error: 'Unknown action: ' + action };
    }
    return jsonResponse({ ok: true, data: payload, updatedAt: new Date().toISOString() });
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return jsonResponse({ ok: false, error: err.message });
  }
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
    const row = values[i];
    if (row.every(c => c === '' || c === null)) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      let v = row[idx];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      obj[h] = v;
    });
    rows.push(obj);
  }
  return rows;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// Date / biweekly-schedule helpers
// ============================================================
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

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function normalizeDateString(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value || '').trim();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getTasksForDate(date) {
  const dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const dayName = DAY_NAMES[date.getDay()];
  const weekType = getWeekTypeForDate(date);
  const tasks = [];

  getSheetData(SHEET_NAMES.schedule).forEach(function (r) {
    const type = String(r.Type || '').toLowerCase();
    const isDeadlineType = type.indexOf('дедлайн') > -1 || type.indexOf('дз') > -1 || type.indexOf('deadline') > -1;
    if (!isDeadlineType) return;
    if (String(r.Day || '').trim() !== dayName) return;
    if (Number(r.WeekType) !== weekType) return;
    tasks.push({ subject: r.Subject || '', task: r.Task || '', due: dateStr });
  });

  getSheetData(SHEET_NAMES.homeworkPool).forEach(function (r) {
    if (normalizeDateString(r.Deadline_Date) === dateStr) {
      tasks.push({ subject: r.Subject || '', task: r.Task_Description || '', due: dateStr });
    }
  });

  return tasks;
}

function formatTaskLines(tasks) {
  return tasks.map(function (t) {
    return '• <b>[' + esc(t.subject) + ']</b>: ' + esc(t.task) + ' (' + t.due + ')';
  });
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

// ============================================================
// FEATURE 1 — 3-day deadline reminders
// ============================================================
function checkAndSend3DayReminders() {
  const target = addDays(new Date(), 3);
  const tasks = getTasksForDate(target);
  if (!tasks.length) {
    Logger.log('checkAndSend3DayReminders: nothing due in 3 days (' + normalizeDateString(target) + ')');
    return;
  }
  const message = '⏰ <b>Напоминание: через 3 дня (' + normalizeDateString(target) + ') сдача:</b>\n\n' +
    formatTaskLines(tasks).join('\n');
  sendTelegramMessage(CHAT_ID, TOPIC_ID, message, null);
}

// ============================================================
// FEATURE 2 — Project enrollment via Telegram inline keyboard
// ============================================================
function buildProjectsKeyboard(projectRows) {
  const buttons = [];
  projectRows.forEach(function (r) {
    const max = Number(r.Max_Capacity) || 0;
    const cur = Number(r.Current_Count) || 0;
    if (cur >= max) return; // заполнено — не предлагаем кнопку
    buttons.push([{ text: '✅ Записаться: ' + r.Project_Name + ' (' + (max - cur) + ' мест)', callback_data: 'enroll:' + r.Project_ID }]);
  });
  return buttons;
}

function handleCallbackQuery(cq) {
  const data = cq.data || '';
  const parts = data.split(':');
  if (parts[0] !== 'enroll') return;

  const projectId = parts[1];
  const fromId = cq.from.id;
  const fromName = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') || ('@' + (cq.from.username || fromId));

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
    const studSheet = ss.getSheetByName(SHEET_NAMES.studentProjects);
    
    const projData = projSheet.getDataRange().getValues();
    
    let rowIndex = -1;
    for (let i = 1; i < projData.length; i++) {
      if (String(projData[i][0]) === String(projectId)) { rowIndex = i; break; }
    }

    if (rowIndex === -1) {
      answerCallback(cq.id, '❌ Проект не найден.', true);
      return;
    }

    const row = projData[rowIndex];
    const projectName = row[1];
    const subject = row[2];
    const maxCap = Number(row[3]) || 0;
    const curCount = Number(row[4]) || 0;
    const status = row[7] || 'Active';

    if (status === 'Expired' || status === 'Archived') {
      answerCallback(cq.id, '⚠️ Дедлайн проекта истек. Запись закрыта!', true);
      return;
    }

    // Проверка лимита мест
    if (curCount >= maxCap) {
      answerCallback(cq.id, '⚠️ В этой команде больше нет мест!', true);
      return;
    }

    // Проверка на дубликат
    const studentData = studSheet.getDataRange().getValues();
    const isEnrolled = studentData.slice(1).some(r => String(r[0]) === String(fromId) && String(r[3]) === String(projectName));
    
    if (isEnrolled) {
      answerCallback(cq.id, 'Вы уже состоите в этой команде! ✅', false);
      return;
    }

    // Увеличиваем счетчик и добавляем студента
    projSheet.getRange(rowIndex + 1, 5).setValue(curCount + 1);
    studSheet.appendRow([fromId, fromName, subject, projectName, new Date().toISOString()]);

    answerCallback(cq.id, '✅ Вы успешно записаны в команду «' + projectName + '»!', false);

  } catch (err) {
    Logger.log('Ошибка записи: ' + err);
  } finally {
    lock.releaseLock();
  }
}

function notifyProjectUpdateInTelegram(subject, projectName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const studSheet = ss.getSheetByName(SHEET_NAMES.studentProjects);
  const students = studSheet.getDataRange().getValues().slice(1)
    .filter(r => String(r[3]) === String(projectName))
    .map(r => r[1]);

  const text = `📌 <b>Обновление команды по предмету ${esc(subject)}!</b>\n\n` +
               `Проект: <b>${esc(projectName)}</b>\n` +
               `Участники:\n` + students.map(s => '• ' + esc(s)).join('\n') + 
               `\n\n⚠️ <i>Если проект заполнен, новые заявки не учитываются!</i>`;

  sendTelegramMessage(CHAT_ID, TOPIC_ID, text, null);
}

function answerCallback(callbackQueryId, text, showAlert) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ callback_query_id: callbackQueryId, text: text, show_alert: !!showAlert }),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery', options);
}

// ============================================================
// ПРИЕМ НОВЫХ ПРОЕКТОВ И ДЕДЛАЙНОВ ИЗ ФОРМ (onFormSubmit)
// Срабатывает на installable-триггере "При отправке формы" (form submit).
// ВАЖНО: onSpreadsheetFormSubmit() ниже обрабатывает другой тип триггера
// (привязанный к вкладке Form Responses) — их можно использовать вместе.
// ============================================================
function onFormSubmit(e) {
  try {
    if (!e || !e.namedValues) return;
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Обработка Формы 1: Добавление Дедлайна
    const taskDesc = firstValue(e.namedValues, ['Task Description', 'Задание', 'Task']);
    if (taskDesc) {
      const subject = firstValue(e.namedValues, ['Subject', 'Предмет']);
      const dueDate = firstValue(e.namedValues, ['Due Date', 'Дедлайн', 'Deadline', 'Date']);
      
      const hwSheet = ss.getSheetByName(SHEET_NAMES.homeworkPool);
      if (hwSheet) {
        const newId = 'HW-' + new Date().getTime();
        hwSheet.appendRow([newId, subject, taskDesc, dueDate, new Date().toISOString(), 'Active']);
      }
    }

    // Обработка Формы 2: Добавление Проекта Админом
    const projectName = firstValue(e.namedValues, ['Project Name', 'Название проекта', 'Project_Name']);
    if (projectName) {
      const subject = firstValue(e.namedValues, ['Subject', 'Предмет']);
      const maxCap = firstValue(e.namedValues, ['Max Capacity', 'Макс. вместимость', 'Max_Capacity']) || 4;
      const deadline = firstValue(e.namedValues, ['Deadline', 'Дедлайн', 'Дата']);
      const link = firstValue(e.namedValues, ['Telegram Link', 'Ссылка', 'Telegram_Msg_Link']) || '';

      const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
      if (projSheet) {
        const newProjId = 'P-' + Math.floor(Math.random() * 8999 + 1000);
        projSheet.appendRow([newProjId, projectName, subject, Number(maxCap), 0, deadline, link, 'Active']);
        Logger.log('Админ добавил проект: ' + projectName);
      }
    }

  } catch (err) {
    Logger.log('onFormSubmit error: ' + err);
  }
}

function firstValue(namedValues, keys) {
  for (let i = 0; i < keys.length; i++) {
    if (namedValues[keys[i]] && namedValues[keys[i]][0]) return namedValues[keys[i]][0];
  }
  return '';
}

// ============================================================
// БЕЗОПАСНАЯ СМЕНА СТАТУСОВ (БЕЗ УДАЛЕНИЯ ДАННЫХ)
// Вызывается из doGet() перед выдачей данных.
// ВАЖНО: заменяет autoCleanExpiredHomework() — строки НЕ удаляются,
// вместо удаления проставляется статус "Expired".
// Если на autoCleanExpiredHomework() висит ручной триггер — отключите его,
// иначе он продолжит удалять строки из Homework_Pool.
// ============================================================
function updateExpiredStatuses() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
  if (projSheet) {
    const projData = projSheet.getDataRange().getValues();
    if (projData.length > 1) {
      const headers = projData[0].map(h => String(h).trim());
      const deadlineCol = headers.indexOf('Deadline');
      let statusCol = headers.indexOf('Status');

      if (statusCol === -1) {
        statusCol = headers.length;
        projSheet.getRange(1, statusCol + 1).setValue('Status');
      }

      for (let i = 1; i < projData.length; i++) {
        const rowDateStr = normalizeDateString(projData[i][deadlineCol]);
        const currentStatus = projData[i][statusCol];

        if (rowDateStr && rowDateStr < todayStr && currentStatus !== 'Expired' && currentStatus !== 'Archived') {
          projSheet.getRange(i + 1, statusCol + 1).setValue('Expired');
        }
      }
    }
  }
}

/**
 * СТАРАЯ ВЕРСИЯ (удаляет строки) — оставлена для отката.
 * Вызывайте updateExpiredStatuses() вместо неё.
 */
function autoCleanExpiredHomework() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const hwSheet = ss.getSheetByName(SHEET_NAMES.homeworkPool);
  const hwData = hwSheet.getDataRange().getValues();
  const deadlineCol = hwData[0].indexOf('Deadline_Date');
  let removed = 0;
  for (let i = hwData.length - 1; i >= 1; i--) {
    const rowDateStr = normalizeDateString(hwData[i][deadlineCol]);
    if (rowDateStr && rowDateStr < todayStr) { hwSheet.deleteRow(i + 1); removed++; }
  }
  Logger.log('autoCleanExpiredHomework: removed ' + removed + ' expired Homework_Pool rows');

  const schSheet = ss.getSheetByName(SHEET_NAMES.schedule);
  const schData = schSheet.getDataRange().getValues();
  const oneTimeCol = schData[0].indexOf('One_Time_Date');
  if (oneTimeCol === -1) {
    Logger.log('autoCleanExpiredHomework: Schedule has no One_Time_Date column — skipping');
    return;
  }
  const taskCol = schData[0].indexOf('Task');
  const typeCol = schData[0].indexOf('Type');
  let cleared = 0;
  for (let i = 1; i < schData.length; i++) {
    const oneTimeDate = normalizeDateString(schData[i][oneTimeCol]);
    if (oneTimeDate && oneTimeDate < todayStr) {
      if (taskCol > -1) schSheet.getRange(i + 1, taskCol + 1).setValue('');
      if (typeCol > -1) schSheet.getRange(i + 1, typeCol + 1).setValue('');
      schSheet.getRange(i + 1, oneTimeCol + 1).setValue('');
      cleared++;
    }
  }
  Logger.log('autoCleanExpiredHomework: cleared ' + cleared + ' resolved one-time Schedule rows');
}

// ============================================================
// ВЕБХУКИ И УВЕДОМЛЕНИЯ В TELEGRAM
// ============================================================
function doPost(e) {
  const responseOK = ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  
  try {
    if (!e || !e.postData || !e.postData.contents) return responseOK;

    // Проверка секрета
    if (WEBHOOK_SECRET && e.parameter && e.parameter.token !== WEBHOOK_SECRET) {
      return responseOK;
    }

    const update = JSON.parse(e.postData.contents);
    const msg = update.message || update.edited_message;

    if (!msg || !msg.text || msg.from.is_bot) return responseOK;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const threadId = msg.message_thread_id;

    // Реакция на команду /start или /help
    if (text === '/start' || text === '/help') {
      sendTelegramMessage(chatId, threadId, 
        '👋 Привет! Я бот Class Hub.\n\nЗайди на наш сайт, чтобы посмотреть актуальные дедлайны, проекты и расписание:',
        [[{ text: '📱 Открыть Class Hub', url: WEB_APP_TELEGRAM_LINK }]]
      );
      return responseOK;
    }

    // Реакция на ключевые слова "дедлайн", "проект", "домашка"
    const lowerText = text.toLowerCase();
    if (lowerText.includes('дедлайн') || lowerText.includes('проект') || lowerText.includes('домашка') || lowerText.includes('сдать')) {
      sendTelegramMessage(chatId, threadId, 
        '📅 Все актуальные дедлайны и проекты доступны на сайте Class Hub!',
        [[{ text: '🔗 Перейти к дедлайнам', url: WEB_APP_TELEGRAM_LINK }]]
      );
      return responseOK;
    }

  } catch (err) {
    Logger.log('Ошибка doPost: ' + err.toString());
  }

  return responseOK;
}

// Простая версия: реагирует только на ключевые слова.
// ВНИМАНИЕ: Gemini-логика ниже (classifyIntent/classifyIntentWithGemini/
// buildReplyForIntent) больше не вызывается. Если нужен умный разбор
// сообщений — верни вызов classifyIntent()/buildReplyForIntent() сюда.
function handleTextMessage(msg) {
  const text = msg.text;
  const chatId = msg.chat.id; 
  const threadId = msg.message_thread_id || null; 
  const replyToMsgId = msg.message_id;

  if (text.toLowerCase().includes('дедлайн') || text.toLowerCase().includes('проект')) {
    sendTelegramReply(chatId, threadId, '📱 Посмотреть все актуальные дедлайны и проекты можно на сайте Class Hub!', [[{ text: '📱 Открыть Class Hub', url: WEB_APP_TELEGRAM_LINK }]], replyToMsgId);
  }
}

// ============================================================
// Intent classification (Gemini + keyword fallback)
// ============================================================
function classifyIntent(userText) {
  const aiResult = classifyIntentWithGemini(userText);
  if (aiResult === null) return fallbackKeywordSearch(userText);
  if (!aiResult.type || aiResult.type === 'UNKNOWN') {
    const fb = fallbackKeywordSearch(userText);
    return fb.type !== 'UNKNOWN' ? fb : aiResult;
  }
  return aiResult;
}

function classifyIntentWithGemini(userText) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + GEMINI_API_KEY;
  const prompt =
    'You are an assistant for a student group chat. Classify the intent of the student message.\n' +
    'The message may be misspelled, slangy, in Russian, Kyrgyz, or English.\n\n' +
    'intent.type values:\n' +
    '- "TOMORROW_HW": what is due tomorrow / tomorrow\'s schedule.\n' +
    '- "DEADLINES": deadlines, tests, project due dates in general.\n' +
    '- "MY_GROUP": subgroups (English/Kyrgyz) or project teams.\n' +
    '- "SYLLABUS": syllabi, grading criteria, course materials.\n' +
    '- "PROJECTS_BY_SUBJECT": what projects exist, optionally for a specific subject.\n' +
    '- "WHO_IN_PROJECT": who is enrolled in which project.\n' +
    '- "WEEK_DEADLINES": what is due this week.\n' +
    '- "UNKNOWN": small talk, greetings, off-topic.\n\n' +
    'If the message names a subject (e.g. "Biology", "Calculus"), put it in "subject", else null.\n' +
    'Return ONLY JSON like {"type":"TOMORROW_HW","subject":null} — no markdown, no extra text.\n\n' +
    'Message: "' + userText + '"';

  const options = {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) { Logger.log('Gemini HTTP ' + status + ': ' + response.getContentText()); return null; }
    const json = JSON.parse(response.getContentText());
    if (json.error) { Logger.log('Gemini API error: ' + JSON.stringify(json.error)); return null; }
    let raw = json.candidates[0].content.parts[0].text.trim().replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(raw);
    return parsed && parsed.type ? parsed : null;
  } catch (err) {
    Logger.log('Gemini call exception: ' + err);
    return null;
  }
}

function fallbackKeywordSearch(userText) {
  const t = userText.toLowerCase();
  const groups = {
    TOMORROW_HW: ['завтра', 'эртен', 'домашк', 'дз', 'homework', 'tomorrow', 'задали'],
    WEEK_DEADLINES: ['на этой неделе', 'на неделе', 'this week'],
    DEADLINES: ['дедлайн', 'deadline', 'сдач', 'сдавать', 'due'],
    MY_GROUP: ['группа', 'команда', 'подгруппа', 'team', 'group', 'кайсы топ'],
    SYLLABUS: ['силлабус', 'силлобус', 'syllabus', 'критери', 'программа курса'],
    WHO_IN_PROJECT: ['кто в каком проект', 'кто где', 'кто записался'],
    PROJECTS_BY_SUBJECT: ['проект', 'запис', 'project']
  };
  for (const type in groups) {
    for (let i = 0; i < groups[type].length; i++) {
      if (t.indexOf(groups[type][i]) > -1) return { type: type, subject: extractSubjectAfter(t, 'по ') };
    }
  }
  return { type: 'UNKNOWN', subject: null };
}

function extractSubjectAfter(text, marker) {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const rest = text.slice(idx + marker.length).trim();
  return rest ? rest.split(/[.,!?\n]/)[0].trim() : null;
}

function buildReplyForIntent(intentType, subject) {
  switch (intentType) {
    case 'TOMORROW_HW':
    case 'DEADLINES': {
      const tasks = getTasksForDate(addDays(new Date(), 1));
      const text = tasks.length
        ? '📌 <b>Задания и дедлайны на завтра:</b>\n\n' + formatTaskLines(tasks).join('\n')
        : '🎉 <b>На завтра никаких дедлайнов и домашнего задания нет!</b>';
      return { text: text, buttons: [[{ text: '📱 Открыть Class Hub', url: WEB_APP_TELEGRAM_LINK }]] };
    }
    case 'WEEK_DEADLINES': {
      let allTasks = [];
      for (let i = 0; i < 7; i++) allTasks = allTasks.concat(getTasksForDate(addDays(new Date(), i)));
      const text = allTasks.length
        ? '🗓 <b>Дедлайны на этой неделе:</b>\n\n' + formatTaskLines(allTasks).join('\n')
        : '🎉 <b>На этой неделе дедлайнов нет!</b>';
      return { text: text, buttons: [[{ text: '📱 Открыть Class Hub', url: WEB_APP_TELEGRAM_LINK }]] };
    }
    case 'MY_GROUP':
      return {
        text: '👥 <b>Распределение по группам:</b>\nОткрой Mini App, чтобы в 1 клик найти свою подгруппу.',
        buttons: [[{ text: '🔍 Найти себя в Class Hub', url: WEB_APP_TELEGRAM_LINK }]]
      };
    case 'SYLLABUS':
      return {
        text: '📄 <b>Силлабусы и материалы:</b>\nВсе учебные программы собраны в приложении.',
        buttons: [[{ text: '📁 Открыть силлабусы', url: WEB_APP_TELEGRAM_LINK }]]
      };
    case 'PROJECTS_BY_SUBJECT': {
      const rows = getSheetData(SHEET_NAMES.projects);
      const filtered = subject ? rows.filter(function (r) { return String(r.Subject || '').toLowerCase().indexOf(subject.toLowerCase()) > -1; }) : rows;
      if (!filtered.length) return { text: '😕 Проектов' + (subject ? ' по «' + esc(subject) + '»' : '') + ' пока нет.' };
      const lines = filtered.map(function (r) {
        const free = (Number(r.Max_Capacity) || 0) - (Number(r.Current_Count) || 0);
        return '• <b>' + esc(r.Project_Name) + '</b> (' + esc(r.Subject) + ') — свободно: ' + free + '/' + (r.Max_Capacity || 0);
      });
      return { text: '📋 <b>Доступные проекты:</b>\n\n' + lines.join('\n'), buttons: buildProjectsKeyboard(filtered) };
    }
    case 'WHO_IN_PROJECT': {
      const spRows = getSheetData(SHEET_NAMES.studentProjects);
      if (!spRows.length) return { text: 'Пока никто никуда не записался.' };
      const grouped = {};
      spRows.forEach(function (r) {
        const key = r.Project_Name || 'Без названия';
        (grouped[key] = grouped[key] || []).push(r.Student_Name || String(r.Telegram_ID));
      });
      const lines = Object.keys(grouped).map(function (name) { return '• <b>' + esc(name) + '</b>: ' + grouped[name].map(esc).join(', '); });
      return { text: '👥 <b>Распределение по проектам:</b>\n\n' + lines.join('\n') };
    }
    default:
      return null;
  }
}

// ============================================================
// Telegram send helpers
// ============================================================
function sendTelegramReply(chatId, threadId, text, buttons, replyToMsgId) {
  const payload = { chat_id: chatId, text: text, parse_mode: 'HTML', allow_sending_without_reply: true };
  if (replyToMsgId) payload.reply_to_message_id = replyToMsgId;
  if (threadId !== undefined && threadId !== null) payload.message_thread_id = threadId;
  if (buttons && buttons.length > 0) payload.reply_markup = { inline_keyboard: buttons };
  
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
}

function sendTelegramMessage(chatId, threadId, text, buttons) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };

  if (threadId) payload.message_thread_id = threadId;
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };

  UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function postToTelegram(method, payload) {
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  try {
    const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, options);
    Logger.log(method + ' status: ' + response.getResponseCode() + ' body: ' + response.getContentText());
  } catch (err) {
    Logger.log(method + ' error: ' + err);
  }
}

// ============================================================
// Webhook setup / diagnostics
// ============================================================
function setupWebhook() {
  // Получаем URL текущего развернутого скрипта
  const webAppUrl = ScriptApp.getService().getUrl();
  
  if (!webAppUrl || webAppUrl.indexOf('/exec') === -1) {
    Logger.log('ОШИБКА: Сначала сделайте Deploy (Развертывание) как Веб-приложение!');
    return;
  }

  const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webAppUrl)}?token=${WEBHOOK_SECRET}`;
  
  const response = UrlFetchApp.fetch(telegramApiUrl);
  Logger.log('Результат привязки вебхука: ' + response.getContentText());
}

function deleteWebhook() {
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/deleteWebhook', { method: 'post', muteHttpExceptions: true });
  Logger.log('deleteWebhook: ' + response.getContentText());
}

function checkWebhookInfo() {
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo', { method: 'get', muteHttpExceptions: true });
  Logger.log('getWebhookInfo: ' + response.getContentText());
}



/**
 * Функция для автоматического заполнения Google Таблицы тестовыми данными.
 * Запустите функцию seedDatabase() один раз в редакторе Apps Script.
 */
/**
 * Функция для очистки и инициализации структуры Google Таблицы.
 * Создает пустую вкладку Deadlines под формы и заполняет остальные вкладки.
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Список всех участников (ROSTER)
  const ROSTER = [
    { name: 'Dean Rasul', username: 'JulionMusic' },
    { name: 'Кашапов Тагир', username: 'dragontag56' },
    { name: 'altynai kurmanbekova', username: 'atysh_oo' },
    { name: 'Nuraiym Kaldarova', username: 'nuuuuraai' },
    { name: 'Айдарбеков Байыш', username: 'tbaiysh' },
    { name: 'Danila Rubanovа', username: '' },
    { name: 'Атаян Нуржанов', username: '' },
    { name: 'zhunushova aruunai', username: 'dqoklqdno999' },
    { name: 'Kaziev Yryskeldi', username: 'KapralcHI' },
    { name: 'Эрмекбайев Юнус', username: '' },
    { name: 'Харламова Дарья ', username: 'wszystko_jest_popierdolone' },
    { name: 'altynai kurmanova', username: 'legendofdagestan' },
    { name: 'Asanbekov Joodar', username: 'Jodiko03' },
    { name: 'Эренбек Касымбеков', username: '' },
    { name: 'Рахманбердиева Айдеми', username: 'fg02110' },
    { name: 'maksutova amira', username: 'ammwerssd' },
    { name: 'Manuliksasa', username: 'manuliksasa' },
    { name: 'ergeshbayevaa aisha', username: 'saturnyashh' },
    { name: 'stella avaskanova', username: 'sllt_19' },
    { name: 'Akniet Kubanychbekova', username: 'kbvaa_ae' },
    { name: 'Акылбеков Умар', username: 'um3r_10' },
    { name: 'Нурадиль Жумалиев', username: 'gagtores' },
    { name: 'Нурсултан', username: '' }
  ];

  function formatMember(student) {
    return student.username ? `${student.name} (@${student.username})` : student.name;
  }

  // Удаляем старую вкладку Schedule, если она есть
  const oldSchedule = ss.getSheetByName('Schedule');
  if (oldSchedule) {
    // Нельзя удалить единственный лист, создаем сначала новый
    if (ss.getSheets().length === 1) ss.insertSheet('Temp');
    ss.deleteSheet(oldSchedule);
  }

  // --- ВКЛАДКА 1: Deadlines (ПУСТАЯ ДЛЯ ФОРМЫ) ---
  let sheetDeadlines = ss.getSheetByName('Deadlines');
  if (!sheetDeadlines) sheetDeadlines = ss.insertSheet('Deadlines');
  sheetDeadlines.clear();
  
  // Создаем только заголовки (подходит для связки с Google Формой)
  sheetDeadlines.appendRow(['Subject', 'Task', 'Date', 'Type', 'Credits', 'Points', 'Link']);


  // --- ВКЛАДКА 2: Projects ---
  let sheetProjects = ss.getSheetByName('Projects');
  if (!sheetProjects) sheetProjects = ss.insertSheet('Projects');
  sheetProjects.clear();
  sheetProjects.appendRow(['Project_ID', 'Project_Name', 'Subject', 'Max_Capacity', 'Current_Count', 'Deadline', 'Telegram_Msg_Link']);
  
  const projectsData = [
    ['P1', 'Разработка Telegram Mini App на JS', 'Информатика', 4, 4, '2026-10-25', 'https://t.me/c/1004379161096/3/101'],
    ['P2', 'Анализ данных и визуализация на Python', 'Базы данных', 3, 3, '2026-10-28', 'https://t.me/c/1004379161096/3/102'],
    ['P3', 'Расчет моста и сопротивление материалов', 'Физика', 5, 4, '2026-11-02', 'https://t.me/c/1004379161096/3/103'],
    ['P4', 'Исследование методов оптимизации функций', 'Высшая математика', 3, 2, '2026-11-05', 'https://t.me/c/1004379161096/3/104'],
    ['P5', 'Английский разговорный клуб (Стартап-питч)', 'Английский язык', 4, 3, '2026-11-10', 'https://t.me/c/1004379161096/3/105']
  ];
  sheetProjects.getRange(2, 1, projectsData.length, projectsData[0].length).setValues(projectsData);


  // --- ВКЛАДКА 3: Student_Projects ---
  let sheetStudentProjects = ss.getSheetByName('Student_Projects');
  if (!sheetStudentProjects) sheetStudentProjects = ss.insertSheet('Student_Projects');
  sheetStudentProjects.clear();
  sheetStudentProjects.appendRow(['Telegram_ID', 'Student_Name', 'Subject', 'Project_Name', 'Timestamp']);

  const studentProjectsData = [
    // Проект P1 (4/4)
    ['', formatMember(ROSTER[0]), 'Информатика', 'Разработка Telegram Mini App на JS', new Date().toISOString()],
    ['', formatMember(ROSTER[1]), 'Информатика', 'Разработка Telegram Mini App на JS', new Date().toISOString()],
    ['', formatMember(ROSTER[2]), 'Информатика', 'Разработка Telegram Mini App на JS', new Date().toISOString()],
    ['', formatMember(ROSTER[3]), 'Информатика', 'Разработка Telegram Mini App на JS', new Date().toISOString()],

    // Проект P2 (3/3)
    ['', formatMember(ROSTER[4]), 'Базы данных', 'Анализ данных и визуализация на Python', new Date().toISOString()],
    ['', formatMember(ROSTER[5]), 'Базы данных', 'Анализ данных и визуализация на Python', new Date().toISOString()],
    ['', formatMember(ROSTER[6]), 'Базы данных', 'Анализ данных и визуализация на Python', new Date().toISOString()],

    // Проект P3 (4/5)
    ['', formatMember(ROSTER[7]), 'Физика', 'Расчет моста и сопротивление материалов', new Date().toISOString()],
    ['', formatMember(ROSTER[8]), 'Физика', 'Расчет моста и сопротивление материалов', new Date().toISOString()],
    ['', formatMember(ROSTER[9]), 'Физика', 'Расчет моста и сопротивление материалов', new Date().toISOString()],
    ['', formatMember(ROSTER[10]), 'Физика', 'Расчет моста и сопротивление материалов', new Date().toISOString()],

    // Проект P4 (2/3)
    ['', formatMember(ROSTER[11]), 'Высшая математика', 'Исследование методов оптимизации функций', new Date().toISOString()],
    ['', formatMember(ROSTER[12]), 'Высшая математика', 'Исследование методов оптимизации функций', new Date().toISOString()],

    // Проект P5 (3/4)
    ['', formatMember(ROSTER[13]), 'Английский язык', 'Английский разговорный клуб (Стартап-питч)', new Date().toISOString()],
    ['', formatMember(ROSTER[14]), 'Английский язык', 'Английский разговорный клуб (Стартап-питч)', new Date().toISOString()],
    ['', formatMember(ROSTER[15]), 'Английский язык', 'Английский разговорный клуб (Стартап-питч)', new Date().toISOString()]
  ];
  sheetStudentProjects.getRange(2, 1, studentProjectsData.length, studentProjectsData[0].length).setValues(studentProjectsData);


  // --- ВКЛАДКА 4: Syllabus ---
  let sheetSyllabus = ss.getSheetByName('Syllabus');
  if (!sheetSyllabus) sheetSyllabus = ss.insertSheet('Syllabus');
  sheetSyllabus.clear();
  sheetSyllabus.appendRow(['Subject', 'Instructor', 'Title', 'Link']);

  const syllabusData = [
    ['Высшая математика', 'Проф. Иванов А.А.', 'Силлабус курса (Линейная алгебра)', 'https://drive.google.com/file/d/example1/view'],
    ['Информатика & JS', 'Доц. Петров Б.С.', 'Программа обучения: JavaScript & Web', 'https://drive.google.com/file/d/example2/view'],
    ['Физика', 'Д-р Сидоров В.В.', 'Курс общей физики', 'https://drive.google.com/file/d/example3/view']
  ];
  sheetSyllabus.getRange(2, 1, syllabusData.length, syllabusData[0].length).setValues(syllabusData);

  // Удаляем временный лист, если он был создан
  const tempSheet = ss.getSheetByName('Temp');
  if (tempSheet) ss.deleteSheet(tempSheet);

  Logger.log('Таблица очищена! Вкладка Deadlines пуста и готова для заполнения.');
}

/**
 * Вспомогательная функция. Актуальный обработчик doGet() — выше по файлу
 * (он поддерживает getAll / getProjects / getProjectsWithStudents и т.д.).
 * Старый дубликат doGet(), читавший через getActiveSpreadsheet(), удалён:
 * в JS повторное объявление функции перетирало бы новое поведение.
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Автоматический триггер: срабатывает при отправке Google Формы.
 * Переносит данные из ответов формы во вкладку 'Deadlines' с форматированием.
 */
/**
 * Единый триггер для Google Форм (Срабатывает при отправке формы в таблицу)
 */
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
    } catch (err) {
      Logger.log('Form submit error: ' + err.toString());
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

  const leaderName  = (values[1] || '').trim();
  const subject     = (values[2] || '').trim();
  const projectName = (values[3] || '').trim();

  const applicants = [leaderName, values[4], values[5], values[6]]
    .map(v => (v || '').trim())
    .filter(v => v.length > 0);

  if (!projectName || applicants.length === 0) return;

  const projectsData = projectsSheet.getDataRange().getValues();
  let projectRow = -1, maxCap = 0, curCount = 0;

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

    // Удаляем проект из формы, если заполнился
    if (newCount >= maxCap) {
      removeProjectFromFormChoices(projectName);
    }
  }
}
/**
 * Функция для автоматического обновления вариантов ответа в Google Форме
 * Запускай её при изменении списка проектов в Таблице.
 */
function updateFormOptions() {
  const FORM_ID = 'ВСТАВЬ_СЮДА_ID_GOOGLE_ФОРМЫ'; // ID формы из ссылки
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Получаем список актуальных проектов из вкладки Projects
  const sheetProjects = ss.getSheetByName('Projects');
  if (!sheetProjects) return;
  
  const data = sheetProjects.getDataRange().getValues();
  const availableProjects = [];
  
  for (let i = 1; i < data.length; i++) {
    const projectName = data[i][1]; // Project_Name
    const maxCapacity = Number(data[i][3]); // Max_Capacity
    const currentCount = Number(data[i][4]); // Current_Count
    
    // Добавляем в форму только те проекты, где ЕЩЕ ЕСТЬ МЕСТА
    if (currentCount < maxCapacity && projectName) {
      availableProjects.push(projectName);
    }
  }

  // 2. Обновляем выпадающий список в Google Форме
  const form = FormApp.openById(FORM_ID);
  const items = form.getItems();

  items.forEach(item => {
    // Находим вопрос "Выберите проект"
    if (item.getTitle().includes('проект') || item.getTitle().includes('Проект')) {
      if (item.getType() === FormApp.ItemType.LIST) {
        const listItem = item.asListItem();
        if (availableProjects.length > 0) {
          listItem.setChoiceValues(availableProjects);
        } else {
          listItem.setChoiceValues(['Все проекты забиты!']);
        }
      }
    }
  });
}


/**
 * Автоматически скрывает заполнившийся проект из Google Формы №2
 */
function removeProjectFromFormChoices(projectName) {
  if (!CONFIG.TEAM_FORM_ID || CONFIG.TEAM_FORM_ID.includes('YOUR_')) return;

  try {
    const form = FormApp.openById(CONFIG.TEAM_FORM_ID);
    const items = form.getItems();

    items.forEach(item => {
      const type = item.getType();
      if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.MULTIPLE_CHOICE) {
        if (item.getTitle().toLowerCase().includes('проект')) {
          const choiceItem = type === FormApp.ItemType.LIST ? item.asListItem() : item.asMultipleChoiceItem();
          const updatedChoices = choiceItem.getChoices().filter(c => c.getValue().trim() !== projectName.trim());

          if (updatedChoices.length > 0) {
            choiceItem.setChoices(updatedChoices);
          } else {
            choiceItem.setChoiceValues(['Все проекты забиты!']);
          }
        }
      }
    });
  } catch (err) {
    Logger.log('Auto-limiter error: ' + err.toString());
  }
}

/**
 * Функция динамически наполняет выпадающий список в Google Форме 
 * актуальными (активными) проектами из Google Таблицы.
 */
function syncFormOptionsWithSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const projectsSheet = ss.getSheetByName('Projects');
  if (!projectsSheet) return;

  const data = projectsSheet.getDataRange().getValues();
  const activeProjects = [];

  // Проходим по таблице (пропуская заголовок)
  for (let i = 1; i < data.length; i++) {
    const projectName = String(data[i][1]).trim(); // Column B: Project_Name
    const maxCapacity = Number(data[i][3]) || 0;    // Column D: Max_Capacity
    const currentCount = Number(data[i][4]) || 0;   // Column E: Current_Count
    const status = String(data[i][7] || 'Active').trim(); // Column H: Status (опционально)

    // Добавляем проект только если есть свободные места и он активен
    if (projectName && currentCount < maxCapacity && status !== 'Archived') {
      activeProjects.push(projectName);
    }
  }

  // Обновляем Google Форму
  if (!CONFIG.TEAM_FORM_ID || CONFIG.TEAM_FORM_ID.includes('YOUR_')) return;

  try {
    const form = FormApp.openById(CONFIG.TEAM_FORM_ID);
    const items = form.getItems();

    items.forEach(item => {
      const type = item.getType();
      if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.MULTIPLE_CHOICE) {
        if (item.getTitle().toLowerCase().includes('проект')) {
          const choiceItem = type === FormApp.ItemType.LIST ? item.asListItem() : item.asMultipleChoiceItem();
          
          if (activeProjects.length > 0) {
            choiceItem.setChoiceValues(activeProjects);
          } else {
            choiceItem.setChoiceValues(['Нет доступных проектов для записи']);
          }
        }
      }
    });
    Logger.log('Выпадающий список формы успешно обновлен!');
  } catch (err) {
    Logger.log('Ошибка при обновлении формы: ' + err.toString());
  }
}
