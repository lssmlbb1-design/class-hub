// ============================================================
// Telegram text-query helpers
// ============================================================

/**
 * Обрабатывает вопрос пользователя и возвращает ответ для Telegram.
 * Использует существующую getSheetData(), которая читает таблицу
 * SPREADSHEET_ID.
 */
function processUserQuery(userMessage) {
  try {
    const query = String(userMessage || '').trim();
    const normalized = query.toLowerCase();

    if (!query) {
      return '❓ Напишите вопрос, например: «Что задавали по математике?»';
    }

    if (normalized.indexOf('проект') !== -1 || normalized.indexOf('команд') !== -1) {
      return findProjectsForTelegram();
    }

    if (normalized.indexOf('расписан') !== -1 || normalized.indexOf('занят') !== -1) {
      return findScheduleForTelegram();
    }

    // Запросы о ДЗ/заданиях, включая «что задавали по математике?».
    if (normalized.indexOf('дз') !== -1 ||
        normalized.indexOf('домаш') !== -1 ||
        normalized.indexOf('задан') !== -1 ||
        normalized.indexOf('задавали') !== -1 ||
        normalized.indexOf('дедлайн') !== -1 ||
        normalized.indexOf('по ') !== -1) {
      return findHomeworkForTelegram(query);
    }

    return '❓ Я не понял вопрос. Попробуйте: «Что задавали по математике?» или «Какие проекты есть?»';
  } catch (error) {
    Logger.log('processUserQuery error: ' + error.stack || error);
    return '❌ Не удалось обработать вопрос. Попробуйте ещё раз позже.';
  }
}

function findHomeworkForTelegram(query) {
  try {
    const subject = extractTelegramSubject(query);
    const rows = [];

    // Сначала берём текущие записи из Homework_Pool.
    getSheetData(SHEET_NAMES.homeworkPool).forEach(function (row) {
      const rowSubject = String(row.Subject || '').trim();
      const status = String(row.Status || 'Active').trim().toLowerCase();
      if (status && status !== 'active') return;
      if (subject && !rowSubject.toLowerCase().includes(subject)) return;

      rows.push({
        subject: rowSubject,
        task: row.Task_Description || row.Task || '',
        date: row.Deadline_Date || row.Date || ''
      });
    });

    // Совместимость со старыми записями на листе Deadlines.
    if (rows.length === 0) {
      getSheetData(SHEET_NAMES.deadlines).forEach(function (row) {
        const rowSubject = String(row.Subject || '').trim();
        if (subject && !rowSubject.toLowerCase().includes(subject)) return;

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

    return '📚 <b>Задания:</b>\n\n' + rows.slice(0, 10).map(function (row) {
      let line = '• <b>[' + esc(row.subject || 'Без предмета') + ']</b>: ' + esc(row.task);
      if (row.date) line += ' — <i>' + esc(row.date) + '</i>';
      return line;
    }).join('\n');
  } catch (error) {
    Logger.log('findHomeworkForTelegram error: ' + error.stack || error);
    return '❌ Не удалось прочитать задания из таблицы.';
  }
}

function findScheduleForTelegram() {
  try {
    const rows = getSheetData(SHEET_NAMES.schedule);
    if (!rows.length) return '📅 Расписание пока не найдено.';

    return '📅 <b>Расписание:</b>\n\n' + rows.slice(0, 15).map(function (row) {
      const day = row.Day || row.Date || '';
      const time = row.Time || row.Start_Time || '';
      return '• <b>' + esc(day) + '</b> ' + esc(time) + ': ' +
        esc(row.Subject || '') + (row.Room ? ' (' + esc(row.Room) + ')' : '');
    }).join('\n');
  } catch (error) {
    Logger.log('findScheduleForTelegram error: ' + error.stack || error);
    return '❌ Не удалось прочитать расписание из таблицы.';
  }
}

function findProjectsForTelegram() {
  try {
    const rows = getSheetData(SHEET_NAMES.projects).filter(function (row) {
      const status = String(row.Status || 'Active').toLowerCase();
      return status !== 'expired' && status !== 'archived';
    });

    if (!rows.length) return '📦 Активных проектов не найдено.';

    return '📦 <b>Активные проекты:</b>\n\n' + rows.slice(0, 10).map(function (row) {
      const current = Number(row.Current_Count) || 0;
      const max = Number(row.Max_Capacity) || 0;
      return '• <b>' + esc(row.Project_Name || 'Без названия') + '</b> — ' +
        esc(row.Subject || '') + '\n  Мест: ' + Math.max(0, max - current) + '/' + max;
    }).join('\n');
  } catch (error) {
    Logger.log('findProjectsForTelegram error: ' + error.stack || error);
    return '❌ Не удалось прочитать проекты из таблицы.';
  }
}

function extractTelegramSubject(query) {
  const match = String(query || '').toLowerCase().match(/\bпо\s+([^?!,.;:]+)/);
  if (!match) return '';

  return match[1]
    .replace(/\b(что|задали|задавали|домашнее|домашку|дз|на сегодня|сегодня)\b.*$/i, '')
    .trim();
}
