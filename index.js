// Блокнот рассказчика — модель раз в N сообщений сама решает,
// что хочет реализовать / спросить / придумать, и записывает это.
// Записи хранятся в метаданных чата и подмешиваются в промпт.

const MODULE = 'npc_notebook';
const INJECT_KEY = 'npc_notebook_inject';
const ACTION_INJECT_KEY = 'npc_notebook_actions';

// Константы SillyTavern (extension_prompt_types / extension_prompt_roles)
const POS_IN_CHAT = 1;

const DEFAULT_THINK = `[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. На минуту ты — автор этой истории и ведёшь свой рабочий блокнот. Перечитай чат целиком и пройди по всем разделам ниже.

{{direction}}

{{time}}

{{npcs}}

{{arcs}}

{{intrigues}}

{{wardrobe}}

Задумки на будущее. Подумай как автор: что ты хочешь, чтобы произошло дальше? Как поведут себя NPC, что хочется выяснить у {{user}} через персонажей, что новое можно придумать про мир? Не каждая задумка должна быть проблемой или угрозой: тёплое, забавное, бытовое тоже двигает историю.

Твои задумки сейчас:
{{notes}}

Команды для задумок:
ADD [план]: что хочешь реализовать и к какому сюжетному моменту (например «когда {{user}} вернётся в город»)
ADD [вопрос]: что хочешь выяснить или спросить
ADD [идея]: новая придумка про NPC или мир
DONE #номер — задумка уже реализовалась
DROP #номер — задумка больше не подходит
Привязывай задумки к сюжетным событиям или датам внутри истории, а не к счёту дней от текущего момента. Если в чате был таймскип, проверь каждую запись: что уже случилось бы за кадром — DONE или перепиши как последствие; что потеряло смысл — DROP. Не больше трёх новых ADD.

Ответь ТОЛЬКО командами, каждая с новой строки, без пояснений и без текста роли. Пройди все разделы: если в разделе нечего добавить — пропусти его. Если нечего ни в одном — ответь одним словом: NONE]`;

const INJECT_FF_KEY = 'npc_notebook_ff';
const FF_MARKER = '[Перемотка:';

const DEFAULT_INJECT = `[Личный блокнот автора. Это твои собственные задумки на будущее сюжета. Не упоминай блокнот и не цитируй его. Вплетай задумки естественно и постепенно, когда момент подходит; не нужно реализовывать всё сразу и не нужно форсировать. Отсчёт «сообщ. назад» — это сообщения чата, а не сюжетное время; в истории могли пройти дни или недели.]
{{notes}}`;

const REROLL_PROMPT = `[OOC: Пауза в ролевой игре. Ты — автор этой истории. Игроку не понравилась одна из твоих задумок:
«{{old}}»

Придумай одну другую задумку взамен — отличающуюся по сути, а не перефразированную. Учитывай, что происходило в чате.

Остальные задумки в блокноте (не повторяй их):
{{notes}}

{{direction}}

Ответь ровно одной строкой в формате:
ADD [тег]: текст задумки]`;

const REROLL_INTRIGUE_PROMPT = `[OOC: Пауза в ролевой игре. Ты — автор этой истории. Игроку не понравилась одна из твоих тайн или интриг:
«{{old}}»

Придумай другую тайну, загадку, слух или интригу взамен — отличающуюся по сути. Учитывай, что происходило в чате и что уже есть в блокноте.

{{direction}}

Ответь ровно одной строкой в формате:
INTRIGUE [тайна|загадка|слух|интрига]: в чём правда на самом деле]`;

const ARC_STAGES = [
    null,
    { name: 'Зарождение', hint: 'старое поведение полностью преобладает; новое проскальзывает редко и неосознанно, персонаж может это отрицать' },
    { name: 'Борьба', hint: 'персонаж замечает в себе новое, иногда выбирает его, но часто откатывается; внутренний конфликт' },
    { name: 'Сдвиг', hint: 'новое поведение проявляется чаще старого, но под стрессом возможен откат' },
    { name: 'Закреплено', hint: 'новая черта — часть характера' },
];
const ARC_MAX = 4;

const ARC_INJECT_HEADER = '[Развитие персонажей. Карточки описывают, какими персонажи были в начале истории. Ниже — как они изменились с тех пор: где это противоречит карточке, верно то, что ниже. Ядро личности, манера речи и привычки сохраняются; изменения проявляются ровно в той мере, какую задаёт стадия.]';

const NPC_INJECT_HEADER = '[Персонажи истории — это канон, держись этих фактов.]';

const INTRIGUE_INJECT_HEADER = '[Тайны и интриги — секрет автора, игрок правды не знает. Раскрывай постепенно: через намёки, улики, оговорки NPC, слухи (в том числе ложные). Не выдавай правду целиком раньше времени и не форсируй.]';

const GENRE_HINTS = {
    'Комедия': 'недоразумения, нелепые ситуации, забавные привычки и реакции, неловкие моменты, конфликты с низкими ставками, которые разрешаются смехом',
    'Повседневность': 'быт, мелкие ритуалы, совместные дела, маленькие открытия друг о друге, уютные события',
    'Романтика': 'сближение, флирт, неловкая забота, ревность без драмы, моменты близости',
    'Эротика': 'притяжение, чувственное напряжение между персонажами, интимные моменты и их предвкушение',
    'Драма': 'серьёзные чувства, внутренние конфликты, трудные решения и их последствия',
    'Ангст': 'боль, тоска, недосказанность, эмоциональные раны',
    'Приключения': 'вылазки, новые места, находки, неожиданные встречи',
    'Экшн': 'стычки, погони, опасность, физические испытания',
    'Мистика': 'необъяснимое, странные совпадения, сверхъестественное',
    'Ужасы': 'страх, жуткое, нарастающая угроза',
    'Детектив': 'загадки, улики, расследование, скрытые мотивы',
};

  // ===================== Время и место =====================
  // Календарь ведёт код: модель только сообщает, сколько прошло времени или какая теперь дата.

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  const COUNTRIES = {
      UK: { name: 'Великобритания', keys: ['великобритан', 'британ', 'англи', 'шотланд', 'уэльс', 'лондон', 'uk', 'united kingdom', 'england', 'britain'] },
      US: { name: 'США', keys: ['сша', 'америк', 'штат', 'нью-йорк', 'калифорни', 'usa', 'united states', 'america'] },
      JP: { name: 'Япония', keys: ['япони', 'токио', 'осака', 'киото', 'japan'] },
      RU: { name: 'Россия', keys: ['росси', 'москв', 'петербург', 'russia'] },
  };

  function detectCountry(text) {
      const t = String(text || '').toLowerCase();
      for (const [code, c] of Object.entries(COUNTRIES)) {
          if (c.keys.some(k => (k.length <= 3 ? new RegExp(`(^|[^a-zа-яё])${k}([^a-zа-яё]|$)`).test(t) : t.includes(k)))) return code;
      }
      return '';
  }

  // Даты храним как 'YYYY-MM-DD', считаем в UTC, чтобы не мешали часовые пояса
  function toDate(iso) {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
  }
  function toIso(dt) {
      return dt.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
      const dt = toDate(iso);
      dt.setUTCDate(dt.getUTCDate() + n);
      return toIso(dt);
  }
  function addMonths(iso, n) {
      const dt = toDate(iso);
      const day = dt.getUTCDate();
      dt.setUTCDate(1);
      dt.setUTCMonth(dt.getUTCMonth() + n);
      const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(day, last));
      return toIso(dt);
  }
  function daysBetween(a, b) {
      return Math.round((toDate(b) - toDate(a)) / 86400000);
  }
  function ymd(y, m, d) {
      return toIso(new Date(Date.UTC(y, m - 1, d)));
  }
  function formatDate(iso, withYear = true) {
      const dt = toDate(iso);
      return `${dt.getUTCDate()} ${MONTHS_GEN[dt.getUTCMonth()]}${withYear ? ' ' + dt.getUTCFullYear() : ''}`;
  }
  function weekday(iso) {
      return WEEKDAYS[toDate(iso).getUTCDay()];
  }
  function plural(n, one, few, many) {
      const a = Math.abs(n) % 100, b = a % 10;
      if (a > 10 && a < 20) return many;
      if (b > 1 && b < 5) return few;
      if (b === 1) return one;
      return many;
  }
  function daysWord(n) {
      return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
  }

  // Пасха: западная (григорианская) и православная (юлианская + 13 дней, верно для 1900–2099)
  function westernEaster(y) {
      const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
      const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
      return ymd(y, month, day);
  }
  function orthodoxEaster(y) {
      const a = y % 4, b = y % 7, c = y % 19;
      const d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
      const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
      return addDays(ymd(y, month, day), 13);
  }
  // n-й день недели месяца (wd: 0 — вс, 1 — пн…); n = -1 — последний
  function nthWeekday(y, m, wd, n) {
      if (n > 0) {
          const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
          return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
      }
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const lastWd = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
      return ymd(y, m, lastDay - ((lastWd - wd + 7) % 7));
  }

  // Праздники и события. Правила: d — фиксированная дата [месяц, день], to — конец периода,
  // nth — [месяц, день недели, номер], easter / orth — смещение от западной / православной Пасхи, len — длительность в днях
  const HOLIDAYS = {
      ALL: [
          { name: 'Новый год', d: [1, 1] },
          { name: 'День святого Валентина', d: [2, 14] },
          { name: 'Хэллоуин', d: [10, 31] },
          { name: 'Сочельник', d: [12, 24] },
          { name: 'Рождество', d: [12, 25] },
          { name: 'Канун Нового года', d: [12, 31] },
      ],
      UK: [
          { name: 'Новый год', d: [1, 1], note: 'выходной; после вечеринок в канун' },
          { name: 'Ночь Бёрнса', d: [1, 25], note: 'шотландский праздник: хаггис, стихи Роберта Бёрнса' },
          { name: 'День святого Валентина', d: [2, 14], note: 'открытки и ужины в ресторанах' },
          { name: 'Блинный вторник (Pancake Day)', easter: -47, note: 'все едят блины с лимоном и сахаром, школьные забеги с блинами' },
          { name: 'День матери (Mothering Sunday)', easter: -21, note: 'цветы и открытки мамам' },
          { name: 'День святого Патрика', d: [3, 17], note: 'ирландский праздник, отмечают в пабах: зелёный цвет, Guinness' },
          { name: 'День дурака', d: [4, 1], note: 'розыгрыши до полудня' },
          { name: 'Страстная пятница', easter: -2, note: 'выходной, булочки с крестом (hot cross buns)' },
          { name: 'Пасха', easter: 0, note: 'шоколадные яйца, охота за яйцами для детей' },
          { name: 'Пасхальный понедельник', easter: 1, note: 'банковский выходной' },
          { name: 'Майский банковский выходной', nth: [5, 1, 1], note: 'длинные выходные' },
          { name: 'Весенний банковский выходной', nth: [5, 1, -1], note: 'длинные выходные, часто поездки за город' },
          { name: 'День отца', nth: [6, 0, 3] },
          { name: 'Уимблдон', d: [6, 29], len: 14, note: 'теннисный турнир: клубника со сливками, все смотрят матчи' },
          { name: 'Летние школьные каникулы', d: [7, 22], to: [9, 3], note: 'семьи уезжают в отпуск, на море или в Европу' },
          { name: 'Летний банковский выходной', nth: [8, 1, -1], note: 'последний длинный уикенд лета, Ноттинг-Хиллский карнавал в Лондоне' },
          { name: 'Хэллоуин', d: [10, 31], note: 'костюмы, тыквы, дети ходят за сладостями' },
          { name: 'Ночь Гая Фокса (Bonfire Night)', d: [11, 5], note: 'костры и фейерверки' },
          { name: 'Воскресенье памяти', nth: [11, 0, 2], note: 'минута молчания, красные маки на одежде (их носят с конца октября)' },
          { name: 'Сочельник', d: [12, 24] },
          { name: 'Рождество', d: [12, 25], note: 'главный праздник года: индейка, крекеры с бумажными коронами, речь короля по ТВ' },
          { name: 'День подарков (Boxing Day)', d: [12, 26], note: 'выходной, распродажи, футбол' },
          { name: 'Канун Нового года (Хогманай)', d: [12, 31], note: 'вечеринки, фейерверки, «Auld Lang Syne» в полночь' },
      ],
      US: [
          { name: 'Новый год', d: [1, 1] },
          { name: 'День Мартина Лютера Кинга', nth: [1, 1, 3], note: 'федеральный выходной' },
          { name: 'Супербоул', nth: [2, 0, 2], note: 'финал по американскому футболу: вечеринки, крылышки, реклама' },
          { name: 'День святого Валентина', d: [2, 14], note: 'открытки, шоколад, школьники обмениваются валентинками' },
          { name: 'День святого Патрика', d: [3, 17], note: 'всё зелёное, парады, особенно в Нью-Йорке, Бостоне и Чикаго' },
          { name: 'Пасха', easter: 0, note: 'охота за яйцами, пасхальный кролик' },
          { name: 'День матери', nth: [5, 0, 2], note: 'цветы, завтрак маме' },
          { name: 'День памяти (Memorial Day)', nth: [5, 1, -1], note: 'неофициальное начало лета: барбекю, открытие бассейнов' },
          { name: 'Выпускные', d: [5, 20], to: [6, 15], note: 'школьные и университетские выпускные, проммы' },
          { name: 'День отца', nth: [6, 0, 3] },
          { name: 'День независимости', d: [7, 4], note: 'фейерверки, барбекю, флаги' },
          { name: 'День труда', nth: [9, 1, 1], note: 'конец лета, после него начинается учебный год' },
          { name: 'Хэллоуин', d: [10, 31], note: 'костюмы, тыквы, trick-or-treat, украшенные дома' },
          { name: 'День благодарения', nth: [11, 4, 4], note: 'главный семейный праздник: индейка, тыквенный пирог, парад Macy\'s' },
          { name: 'Чёрная пятница', nth: [11, 4, 4], shift: 1, note: 'огромные распродажи' },
          { name: 'Сочельник', d: [12, 24] },
          { name: 'Рождество', d: [12, 25], note: 'ёлка, подарки, носки у камина, рождественские огни на домах' },
          { name: 'Канун Нового года', d: [12, 31], note: 'вечеринки, падение шара на Таймс-сквер' },
      ],
      JP: [
          { name: 'Сёгацу (Новый год)', d: [1, 1], to: [1, 3], note: 'главный праздник: первое посещение храма (хацумодэ), осэти, новогодние открытки, семья' },
          { name: 'День совершеннолетия', nth: [1, 1, 2], note: '20-летние в праздничных кимоно' },
          { name: 'Сэцубун', d: [2, 3], note: 'бросают бобы со словами «Демоны вон, удача в дом!»' },
          { name: 'День святого Валентина', d: [2, 14], note: 'в Японии шоколад дарят девушки — любимым и коллегам' },
          { name: 'Хинамацури (праздник девочек)', d: [3, 3], note: 'выставка кукол хина' },
          { name: 'Белый день', d: [3, 14], note: 'парни отвечают подарками на валентинки' },
          { name: 'Ханами', d: [3, 25], to: [4, 10], note: 'цветёт сакура: пикники под деревьями' },
          { name: 'Начало учебного и рабочего года', d: [4, 1], note: 'новые классы, первокурсники, новые сотрудники' },
          { name: 'Золотая неделя', d: [4, 29], to: [5, 5], note: 'череда выходных, все путешествуют' },
          { name: 'День детей', d: [5, 5], note: 'вывешивают карпов-коинобори' },
          { name: 'Сезон дождей (цую)', d: [6, 7], to: [7, 19], note: 'постоянные дожди, сырость, цветут гортензии' },
          { name: 'Танабата', d: [7, 7], note: 'желания на бумажных полосках на бамбуке' },
          { name: 'Летние фестивали', d: [7, 20], to: [8, 31], note: 'мацури, юкаты, фейерверки, уличная еда' },
          { name: 'Обон', d: [8, 13], to: [8, 16], note: 'поминовение предков, поездки в родные места, танцы бон-одори' },
          { name: 'День почитания старших', nth: [9, 1, 3] },
          { name: 'Хэллоуин', d: [10, 31], note: 'костюмированные толпы в Сибуе' },
          { name: 'Сити-го-сан', d: [11, 15], note: 'дети 3, 5 и 7 лет в нарядах идут в храм' },
          { name: 'Сочельник', d: [12, 24], note: 'в Японии — романтический вечер для пар, курица из KFC и клубничный торт' },
          { name: 'Омисока (канун Нового года)', d: [12, 31], note: 'уборка, лапша тосикоси-соба, 108 ударов храмового колокола' },
      ],
      RU: [
          { name: 'Новогодние каникулы', d: [1, 1], to: [1, 8], note: 'длинные выходные: оливье, мандарины, гости' },
          { name: 'Рождество', d: [1, 7], note: 'православное Рождество' },
          { name: 'Старый Новый год', d: [1, 14] },
          { name: 'Крещение', d: [1, 19], note: 'купание в проруби' },
          { name: 'Татьянин день', d: [1, 25], note: 'день студентов' },
          { name: 'День святого Валентина', d: [2, 14] },
          { name: 'Масленица', orth: -55, len: 7, note: 'неделя блинов, в последний день сжигают чучело' },
          { name: 'День защитника Отечества', d: [2, 23], note: 'поздравляют мужчин' },
          { name: 'Международный женский день', d: [3, 8], note: 'цветы, особенно тюльпаны и мимоза, поздравляют женщин' },
          { name: 'День смеха', d: [4, 1] },
          { name: 'Пасха', orth: 0, note: 'куличи, крашеные яйца, «Христос воскресе!»' },
          { name: 'Майские праздники', d: [5, 1], to: [5, 11], note: 'шашлыки, дачи, открытие сезона' },
          { name: 'День Победы', d: [5, 9], note: 'парад, салют, георгиевские ленточки' },
          { name: 'День России', d: [6, 12] },
          { name: 'Ивана Купала', d: [7, 7], note: 'венки, костры, гадания' },
          { name: 'День знаний', d: [9, 1], note: 'начало учебного года, линейки, букеты' },
          { name: 'День учителя', d: [10, 5] },
          { name: 'Хэллоуин', d: [10, 31], note: 'не официальный праздник, но молодёжь устраивает костюмированные вечеринки, в барах и клубах тематические ночи' },
          { name: 'День народного единства', d: [11, 4] },
          { name: 'Канун Нового года', d: [12, 31], note: 'ёлка, оливье, речь президента, бой курантов' },
      ],
  };

  function occurrences(h, y) {
      let start;
      if (h.d) start = ymd(y, h.d[0], h.d[1]);
      else if (h.nth) start = addDays(nthWeekday(y, h.nth[0], h.nth[1], h.nth[2]), h.shift || 0);
      else if (h.easter !== undefined) start = addDays(westernEaster(y), h.easter);
      else if (h.orth !== undefined) start = addDays(orthodoxEaster(y), h.orth);
      else if (h.md) start = ymd(y, Number(h.md.slice(0, 2)), Number(h.md.slice(3, 5)));
      else return null;
      let end = start;
      if (h.to) {
          end = ymd(y, h.to[0], h.to[1]);
          if (end < start) end = ymd(y + 1, h.to[0], h.to[1]);
      } else if (h.len) end = addDays(start, h.len - 1);
      return { start, end };
  }

  function holidaysFor(st) {
      const code = st.time.country;
      const base = HOLIDAYS[code] || HOLIDAYS.ALL;
      const custom = (st.time.custom || []).map(c => ({ name: c.name, md: c.md, note: c.note, custom: true, bday: c.bday, who: c.who }));
      return base.concat(custom);
  }

  // Праздники, которые идут сейчас или начнутся в ближайшие days дней
  function upcoming(st, days) {
      const today = st.time.date;
      const y = toDate(today).getUTCFullYear();
      const out = [];
      for (const h of holidaysFor(st)) {
          for (const yy of [y - 1, y, y + 1]) {
              const o = occurrences(h, yy);
              if (!o) continue;
              if (o.end < today) continue;
              const inDays = daysBetween(today, o.start);
              if (inDays > days) continue;
              out.push(Object.assign({}, h, { start: o.start, end: o.end, inDays: inDays, ongoing: o.start <= today }));
              break;
          }
      }
      return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  // Сезон и его приметы (все поддерживаемые страны — в Северном полушарии)
  const SEASON_HINTS = {
      'зима': 'холодно, рано темнеет; тёплая одежда, горячие напитки, снег или слякоть',
      'весна': 'теплеет, всё цветёт, дни становятся длиннее, погода переменчивая',
      'лето': 'тепло или жарко, длинные светлые вечера; отпуска, пляжи, пикники, прогулки допоздна',
      'осень': 'холодает, листопад, дожди, рано темнеет; начало учебного года, уютные вечера дома',
  };
  function season(iso) {
      const m = toDate(iso).getUTCMonth() + 1, d = toDate(iso).getUTCDate();
      const name = [12, 1, 2].includes(m) ? 'зима' : m <= 5 ? 'весна' : m <= 8 ? 'лето' : 'осень';
      const idx = { 'зима': [12, 1, 2], 'весна': [3, 4, 5], 'лето': [6, 7, 8], 'осень': [9, 10, 11] }[name].indexOf(m);
      const phase = idx === 0 ? (d <= 10 ? 'начало' : 'первая половина') : idx === 1 ? 'середина' : (d >= 20 ? 'конец' : 'вторая половина');
      return { name, phase, hint: SEASON_HINTS[name] };
  }

  // Разбор даты из ответа модели или ввода: 2025-02-14, 14.02.2025, 14.02, «14 февраля 2025», «14 февраля»
  function parseDateText(text, refIso) {
      const t = String(text || '').trim().toLowerCase();
      let y, m, d;
      let mm = t.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
      if (mm) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
      if (!mm && (mm = t.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/))) {
          d = Number(mm[1]); m = Number(mm[2]);
          if (mm[3]) y = Number(mm[3].length === 2 ? '20' + mm[3] : mm[3]);
      }
      if (!m) {
          mm = t.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
          if (mm) {
              const mi = MONTHS_GEN.findIndex(x => mm[2].startsWith(x.slice(0, 3)));
              if (mi >= 0) { d = Number(mm[1]); m = mi + 1; if (mm[3]) y = Number(mm[3]); }
          }
      }
      if (!m || !d || m > 12 || d > 31) return null;
      if (!y) {
          // год не указан — берём ближайшую такую дату не раньше текущей даты истории
          const ref = refIso || toIso(new Date());
          y = toDate(ref).getUTCFullYear();
          if (ymd(y, m, d) < ref) y += 1;
      }
      const iso = ymd(y, m, d);
      return toDate(iso).getUTCMonth() + 1 === m ? iso : null;
  }

  // «+3 дня», «2 недели», «месяц», «полгода»
  function parseDuration(text) {
      const t = String(text || '').toLowerCase().replace(',', '.');
      const mm = t.match(/(\d+(?:\.\d+)?)?\s*(дн|ден|сут|недел|нед|месяц|мес|год|лет|полгода|day|days|d\b|week|weeks|w\b|month|months|m\b|year|years|y\b)/);
      if (!mm) return null;
      if (mm[2] === 'полгода') return { months: 6 };
      const n = mm[1] ? Number(mm[1]) : 1;
      if (/^(дн|ден|сут|day|d$)/.test(mm[2])) return { days: Math.round(n) };
      if (/^(нед|week|w$)/.test(mm[2])) return { days: Math.round(n * 7) };
      if (/^(мес|month|m$)/.test(mm[2])) return { months: Math.round(n) };
      return { months: Math.round(n * 12) };
  }

  function applyDuration(iso, dur) {
      return dur.months ? addMonths(iso, dur.months) : addDays(iso, dur.days);
  }

  function placeLine(st) {
      const t = st.time;
      const country = COUNTRIES[t.country]?.name || t.countryName || '';
      return [t.city, country].filter(Boolean).join(', ');
  }

  function holidayLine(h, today) {
      const when = h.ongoing
          ? (h.start === h.end ? 'сегодня' : `идёт сейчас (до ${formatDate(h.end, false)})`)
          : h.inDays === 1 ? 'завтра' : `через ${daysWord(h.inDays)} (${formatDate(h.start, false)})`;
      return `— ${h.name}: ${when}${h.note ? ` — ${h.note}` : ''}`;
  }

  // ---------- Хроника: когда что было ----------
  function agoText(days) {
      if (days <= 0) return 'сегодня';
      if (days === 1) return 'вчера';
      if (days < 7) return `${daysWord(days)} назад`;
      if (days < 14) return 'неделю назад';
      if (days < 28) return `${Math.round(days / 7)} ${plural(Math.round(days / 7), 'неделю', 'недели', 'недель')} назад`;
      if (days < 60) return 'месяц назад';
      if (days < 365) { const m = Math.round(days / 30); return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`; }
      const y = Math.round(days / 365);
      return `${y} ${plural(y, 'год', 'года', 'лет')} назад`;
  }
  function timeline(st) {
      if (!Array.isArray(st.time.timeline)) st.time.timeline = [];
      return st.time.timeline;
  }
  function addEvent(st, date, text) {
      const list = timeline(st);
      text = String(text || '').trim();
      if (!text || !date) return false;
      if (list.some(e => e.date === date && e.text.toLowerCase() === text.toLowerCase())) return false;
      list.push({ date, text });
      list.sort((a, b) => a.date.localeCompare(b.date));
      if (list.length > 60) list.splice(0, list.length - 60);
      return true;
  }
  function chronicleLines(st, count) {
      const today = st.time.date;
      return timeline(st).slice(-count).map(e => `— ${formatDate(e.date, false)}${today ? ` (${agoText(daysBetween(e.date, today))})` : ''}: ${e.text}`);
  }

  // Шапка для обычных ответов
  function buildTimeInjection(st) {
      const t = st.time;
      if (!st.direction.time || (!t.date && !placeLine(st))) return '';
      const lines = ['[Время и место истории — держись их, даже если давно не упоминались.'];
      if (t.date) {
          const s = season(t.date);
          lines.push(`Сейчас: ${weekday(t.date)}, ${formatDate(t.date)}. ${s.name[0].toUpperCase() + s.name.slice(1)} (${s.phase}): ${s.hint}.`);
      }
      const place = placeLine(st);
      if (place) lines.push(`Место: ${place}. Еда, деньги, бытовые мелочи, обращения, праздники — местные; не переноси реалии других стран.`);
      if (t.flavor) lines.push(`Местный колорит: ${t.flavor}`);
      if (t.date) {
          const up = upcoming(st, 14);
          if (up.length) {
              lines.push('Праздники и события рядом (персонажи о них знают; разыгрывать не обязательно, но игнорировать странно):');
              up.slice(0, 2).forEach(h => lines.push(holidayLine(h, t.date)));
          }
          const chron = chronicleLines(st, 4);
          if (chron.length) {
              lines.push('Хроника — когда что произошло (держись этих сроков; не путай «на прошлой неделе» и «месяц назад»):');
              chron.forEach(l => lines.push(l));
          }
      }
      return lines.join('\n') + ']';
  }

  // Раздел для размышления
  function buildTimeSection(st) {
      if (!st?.direction?.time) return '';
      const t = st.time;
      const lines = ['Время и место. Календарь ведёт код — ты только сообщаешь изменения.'];
      if (t.date) {
          lines.push(`Последняя известная дата истории: ${weekday(t.date)}, ${formatDate(t.date)}.`);
      } else {
          lines.push('Дата истории ещё не задана. Определи её по чату (упоминания месяца, погоды, праздников, сезона). Если точных подсказок нет — выбери правдоподобную дату, которая подходит к происходящему, и задай её командой DATE.');
      }
      const place = placeLine(st);
      lines.push(place ? `Место: ${place}.` : 'Место ещё не задано. Определи страну и город по чату и задай командой PLACE.');
      if (t.date) {
          const up = upcoming(st, 45);
          if (up.length) {
              lines.push('Ближайшие праздники и события:');
              up.slice(0, 6).forEach(h => lines.push(holidayLine(h, t.date)));
          }
      }
      lines.push('');
      lines.push('Команды для времени и места:');
      lines.push('TIME +N дней / недель / месяцев — сколько сюжетного времени прошло в чате с последней известной даты (оцени по событиям: ночёвки, «на следующий день», таймскипы). Если прошло меньше суток — не пиши ничего.');
      lines.push('DATE ДД.ММ.ГГГГ — если в чате прямо названа дата или нужно задать её впервые.');
      lines.push('PLACE Страна: Город — если место задано впервые или персонажи переехали.');
      lines.push('EVENT: важное событие из чата с прошлой проверки — знакомство, ссора, признание, первый поцелуй, переезд, поездка, праздник. Одна строка, кратко. Дату плагин поставит сам; если событие было не сегодня — EVENT ДД.ММ: текст. Не повторяй то, что уже есть в хронике.');
      const recent = chronicleLines(st, 6);
      if (recent.length) { lines.push('Последнее в хронике:'); recent.forEach(l => lines.push(l)); }
      return lines.join('\n');
  }

  // Обработка команд TIME / DATE / PLACE / LOCAL. Возвращает true, если строка распознана.
  function applyTimeCommand(st, line, res) {
      const t = st.time;
      let m;
      if ((m = line.match(/^TIME\s*[:：]?\s*\+?\s*(.+)$/i))) {
          if (!st.direction.time || !t.date) return true;
          const dur = parseDuration(m[1]);
          if (dur && (dur.days > 0 || dur.months > 0)) {
              const before = t.date;
              t.date = applyDuration(t.date, dur);
              res.timeMoved = daysBetween(before, t.date);
          }
          return true;
      }
      if ((m = line.match(/^DATE\s*[:：]?\s*(.+)$/i))) {
          if (!st.direction.time) return true;
          const iso = parseDateText(m[1], t.date);
          if (iso) {
              if (t.date && iso !== t.date) {
                  res.timeMoved = daysBetween(t.date, iso);
                  if (iso < t.date) handleDateRollback(st, t.date, iso);
              }
              else if (!t.date) res.dateSet = iso;
              t.date = iso;
          }
          return true;
      }
      if ((m = line.match(/^PLACE\s*[:：]?\s*(.+)$/i))) {
          if (!st.direction.time) return true;
          let countryText = m[1], city = '';
          const sep = m[1].match(/^\[?([^\]:：]+?)\]?\s*[:：—–]\s*(.+)$/);
          if (sep) { countryText = sep[1]; city = sep[2]; }
          else if (m[1].includes(',')) { const parts = m[1].split(','); countryText = parts.pop(); city = parts.join(','); }
          const code = detectCountry(countryText) || detectCountry(m[1]);
          const newCountryName = code ? '' : countryText.trim();
          if (code !== t.country || newCountryName !== t.countryName) {
              if (!t.flavorLocked) t.flavor = '';
              res.placeSet = true;
          }
          if (city.trim() !== t.city) res.placeSet = true;
          t.country = code;
          t.countryName = newCountryName;
          t.city = city.trim();
          return true;
      }
      if ((m = line.match(/^EVENT\s*\[?(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)?\]?\s*[:：—–-]\s*(.+)$/i))) {
          if (!st.direction.time || !t.date) return true;
          let date = t.date;
          if (m[1]) {
              const d = parseDateText(m[1].replace(/[-/]/g, '.'), '1900-01-01');
              if (d) {
                  // год не указан — берём ближайшую такую дату не позже текущей
                  date = /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/.test(m[1]) ? d : `${t.date.slice(0, 4)}${d.slice(4)}`;
                  if (date > t.date) date = `${Number(t.date.slice(0, 4)) - 1}${d.slice(4)}`;
              }
          }
          if (addEvent(st, date, m[2])) (res.events = res.events || []).push(m[2].trim());
          return true;
      }
      if ((m = line.match(/^LOCAL\s*[:：—–-]\s*(.+)$/i))) {
          if (st.direction.time && !t.flavorLocked) t.flavor = m[1].trim();
          return true;
      }
      return false;
  }



  // Колорит — отдельным коротким запросом, чтобы модель его не пропускала
  function flavorPrompt(st) {
      return '[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа и не продолжаешь сцену — это короткая техническая справка для автора. ' +
          'Напиши 2–3 предложения о местном колорите для ролевой игры, действие которой происходит здесь: ' + placeLine(st) + '. ' +
          'Перечисли конкретно: типичная еда и напитки, валюта и привычки с деньгами (например, чаевые), транспорт, климат, бытовые мелочи и манера общения местных. ' +
          'Это справка для автора, чтобы не путать реалии разных стран. Не упоминай персонажей и события истории — только само место. Пиши по-русски, без вступления и без списков — сразу текст.]';
  }
  function cleanFlavor(raw) {
      return String(raw || '').replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u2800\u3000\u3164\uFEFF]/g, ' ')
          .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/\*\*/g, '').trim()
          .replace(/^\[|\]$/g, '').replace(/^["«]|["»]$/g, '').trim();
  }

  // ===================== Праздничные события =====================
  // Традиции (классические задачи), скрытая задача, метки в ответах, итог и медали.

  var TRADITIONS = [
    { match: ['хэллоуин'], emoji: '🎃', vibe: 'тыквы на крыльцах, гирлянды из летучих мышей, костюмы в витринах, запах корицы и сладостей', tasks: ['Вырезать фонарь из тыквы', 'Выбрать или смастерить костюм', 'Раздать сладости детям или сходить за сладостями самим', 'Посмотреть ужастик вместе', 'Сходить на хэллоуинскую вечеринку', 'Украсить дом к празднику'] },
    { match: ['валентин'], emoji: '💘', vibe: 'сердечки в витринах, очереди в цветочных, парочки в кафе', tasks: ['Подарить валентинку', 'Устроить романтический ужин', 'Сделать подарок своими руками', 'Сходить на свидание', 'Признаться кому-то в чувствах'] },
    { match: ['белый день'], emoji: '🍬', vibe: 'в магазинах белый шоколад и зефир в подарочных коробках', tasks: ['Ответить на валентинку подарком', 'Выбрать белый шоколад или сладости', 'Вручить подарок лично'] },
    { country: 'JP', match: ['сочельник'], emoji: '🎄', vibe: 'иллюминация, парочки на улицах, очереди за курицей и клубничными тортами', tasks: ['Сходить на свидание', 'Съесть рождественский клубничный торт', 'Заказать курицу из KFC', 'Погулять под иллюминацией'] },
    { match: ['рождество', 'сочельник'], emoji: '🎁', vibe: 'ёлки в окнах, рождественские ярмарки, огоньки, глинтвейн и музыка', tasks: ['Нарядить ёлку', 'Обменяться подарками', 'Испечь рождественское печенье', 'Спеть или послушать рождественские песни', 'Повесить носки для подарков'] },
    { match: ['сёгацу'], emoji: '⛩', vibe: 'очереди у храмов, новогодние украшения из сосны и бамбука, тишина закрытых магазинов', tasks: ['Сходить в храм на хацумодэ', 'Попробовать осэти', 'Вытянуть предсказание омикудзи', 'Отправить новогодние открытки'] },
    { match: ['омисока'], emoji: '🔔', vibe: 'генеральная уборка, запах лапши, ожидание колокола', tasks: ['Сделать генеральную уборку', 'Съесть тосикоси-собу', 'Послушать удары колокола в полночь'] },
    { match: ['новый год', 'новогод', 'канун нового', 'хогманай'], emoji: '🎆', vibe: 'гирлянды, ёлки, предпраздничная суета, запах мандаринов', tasks: ['Нарядить ёлку', 'Приготовить праздничный стол', 'Загадать желание в полночь', 'Посмотреть салют', 'Подарить подарки'] },
    { match: ['масленица'], emoji: '🥞', vibe: 'запах блинов отовсюду, ярмарки, гулянья', tasks: ['Напечь блинов', 'Сходить на гулянья', 'Сжечь чучело Масленицы', 'Попросить прощения в Прощёное воскресенье'] },
    { match: ['блинный'], emoji: '🥞', vibe: 'везде блины, школьники тренируются к блинным забегам', tasks: ['Напечь блинов', 'Попробовать блины с лимоном и сахаром', 'Поучаствовать в блинном забеге'] },
    { match: ['пасха'], emoji: '🐣', vibe: 'крашеные яйца, весенние цветы, праздничная выпечка в витринах', tasks: ['Покрасить яйца', 'Устроить охоту за яйцами', 'Испечь праздничную выпечку', 'Собраться на семейный обед'] },
    { match: ['благодарения'], emoji: '🦃', vibe: 'запах индейки и тыквенного пирога, все едут к родным', tasks: ['Приготовить индейку', 'Испечь тыквенный пирог', 'Собраться за общим столом', 'Сказать, за что благодарен', 'Посмотреть парад или футбол'] },
    { match: ['гая фокса'], emoji: '🎆', vibe: 'запах дыма, костры в парках, хлопки фейерверков', tasks: ['Сходить на костёр', 'Посмотреть фейерверк', 'Пожарить зефир на огне'] },
    { match: ['независимости'], emoji: '🎇', vibe: 'флаги, барбекю во дворах, ожидание фейерверков', tasks: ['Устроить барбекю', 'Посмотреть фейерверк', 'Надеть что-то в цветах флага'] },
    { match: ['женский'], emoji: '💐', vibe: 'тюльпаны и мимоза на каждом углу, очереди в цветочных', tasks: ['Подарить цветы', 'Поздравить близких и коллег', 'Устроить приятный сюрприз'] },
    { match: ['защитника'], emoji: '🎖', vibe: 'открытки, поздравления в офисах, носки и пена для бритья в подарочных наборах', tasks: ['Поздравить мужчин', 'Подарить что-то практичное', 'Устроить праздничный ужин'] },
    { match: ['танабата'], emoji: '🎋', vibe: 'бамбук с разноцветными бумажными полосками, юкаты', tasks: ['Написать желание на бумажной полоске', 'Повесить его на бамбук', 'Надеть юкату'] },
    { match: ['ханами'], emoji: '🌸', vibe: 'розовые облака сакуры, пикники в парках, лепестки на асфальте', tasks: ['Устроить пикник под сакурой', 'Занять место под деревом с утра', 'Сделать фото среди цветов'] },
    { match: ['обон'], emoji: '🏮', vibe: 'фонарики, танцы бон-одори, поезда переполнены едущими домой', tasks: ['Съездить в родные места', 'Станцевать бон-одори', 'Зажечь фонарики'] },
    { match: ['летние фестивали'], emoji: '🎐', vibe: 'юкаты, лотки с уличной едой, фейерверки над рекой', tasks: ['Надеть юкату', 'Попробовать уличную еду', 'Посмотреть фейерверк', 'Поймать золотую рыбку на ярмарке'] },
    { match: ['супербоул'], emoji: '🏈', vibe: 'все обсуждают матч и рекламу, в магазинах горы крылышек и чипсов', tasks: ['Устроить вечеринку у телевизора', 'Наготовить крылышек', 'Поспорить на исход матча'] },
    { match: ['патрика'], emoji: '☘', vibe: 'всё зелёное, парады, переполненные пабы', tasks: ['Надеть что-то зелёное', 'Сходить в паб', 'Посмотреть парад'] },
    { match: ['рожден'], emoji: '🎂', vibe: 'именинника поздравляют с утра', tasks: ['Выбрать подарок', 'Устроить сюрприз', 'Испечь или заказать торт', 'Собрать друзей', 'Сказать тёплые слова'] },
  ];

  function traditionsFor(h, country) {
    var name = String(h.name || '').toLowerCase();
    for (var i = 0; i < TRADITIONS.length; i++) {
      var t = TRADITIONS[i];
      if (t.country && t.country !== country) continue;
      if (t.match.some(function (m) { return name.indexOf(m) >= 0; })) return t;
    }
    if (h.custom) return { emoji: '🗓', vibe: '', tasks: ['Отметить эту дату вместе', 'Сделать что-то памятное'] };
    return null;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }

  function ensureHolidayState(st) {
    if (st.holiday === undefined) st.holiday = null;
    if (!st.holidayDone || typeof st.holidayDone !== 'object') st.holidayDone = {};
    if (!Array.isArray(st.medals)) st.medals = [];
    if (!Array.isArray(st.memories)) st.memories = [];
    if (!Array.isArray(st.traces)) st.traces = [];
    if (!st.notified || typeof st.notified !== 'object') st.notified = {};
  }

  // Праздник, который пора активировать (за leadDays дней до начала и до его конца)
  function holidayToActivate(st, leadDays) {
    var t = st.time;
    if (!t.date || (st.holiday && !st.holiday.finished)) return null;
    var list = upcoming(st, leadDays);
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      var key = h.name + '|' + h.start;
      if (st.holidayDone[key]) continue;
      if (h.bday && isHostileOrEx(h.who || h.name.replace(/^День рождения:\s*/i, ''), st)) continue;
      var tr = traditionsFor(h, t.country);
      if (!tr) continue;
      return { h: h, key: key, tr: tr };
    }
    return null;
  }

  // Настроение секретной задачи — выбирается на удачу
  var MOODS = {
    warm: { icon: '🌟', name: 'тёплый сюрприз', rule: 'особенный момент, который сделает праздник запоминающимся в хорошем смысле или продвинет вперёд отношения и линии персонажей: неожиданная приятность, совпадение, маленькое чудо, жест заботы' },
    chaos: { icon: '🔥', name: 'весёлый хаос', rule: 'забавное происшествие в рамках жанра истории: что-то идёт не по плану, неловкость или суматоха, которую потом будут вспоминать со смехом' }
  };
  var SECRET_RULES = 'Это ситуация или событие, а не сценарий: опиши, что произойдёт или что нужно устроить. Не диктуй персонажам реплики, признания и чувства (никаких «заставить X признаться», «X скажет вслух») — как они отреагируют, решится в сцене.';

  function newHoliday(found) {
    var classic = shuffle(found.tr.tasks).slice(0, 2).map(function (text) { return { text: text, done: false, hidden: false, kind: 'classic' }; });
    return {
      key: found.key, name: found.h.name, emoji: found.tr.emoji, vibe: found.tr.vibe, note: found.h.note || '',
      start: found.h.start, end: found.h.end, tasks: classic, finished: false,
      mood: Math.random() < 0.5 ? 'warm' : 'chaos'
    };
  }

  function moodOf(hol) { return MOODS[hol && hol.mood] || MOODS.warm; }

  function activationPrompt(hol, st, names, direction) {
    var mood = moodOf(hol);
    return [
      '[OOC: Пауза в ролевой игре. Ты — помощник автора. Скоро праздник: ' + hol.name + ' (' + formatDate(hol.start, false) + ')' + (placeLine(st) ? ', место: ' + placeLine(st) : '') + '.',
      direction ? direction + '\n' : '',
      'Классические традиции уже выбраны: ' + hol.tasks.map(function (x) { return '«' + x.text + '»'; }).join(', ') + '.',
      'Придумай по контексту этой ролевой ещё две праздничные задачи для ' + names.user + ' — связанные с праздником И с персонажами, отношениями, происходящим в истории. Лёгкие, выполнимые за пару сцен, строго в духе направления истории.',
      'STORY: открытая сюжетная задача (игрок её видит)',
      'SECRET: скрытая задача-сюрприз (игрок её не видит, а ты будешь ненавязчиво создавать для неё поводы). Её настроение — ' + mood.name + ': ' + mood.rule + '. ' + SECRET_RULES,
      'Ответь ровно двумя строками в этом формате, без пояснений.]'
    ].filter(Boolean).join('\n');
  }

  function cleanLine(raw) {
    return String(raw || '').replace(/[   -​  ⠀　ㅤ﻿]/g, ' ').replace(/\*\*/g, '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
  }

  function applyActivation(hol, raw) {
    var text = cleanLine(raw);
    var story = text.match(/STORY\s*[:：—–-]\s*(.+)/i);
    var secret = text.match(/SECRET\s*[:：—–-]\s*(.+)/i);
    if (story) hol.tasks.push({ text: story[1].trim(), done: false, hidden: false, kind: 'story' });
    if (secret) hol.tasks.push({ text: secret[1].trim(), done: false, hidden: true, kind: 'secret' });
  }

  // Реролл одной задачи праздника
  function rerollTaskPrompt(hol, idx, st, names, direction) {
    var x = hol.tasks[idx];
    var others = hol.tasks.filter(function (y, i) { return i !== idx && !y.hidden; }).map(function (y) { return '«' + y.text + '»'; }).join(', ');
    var what;
    if (x.kind === 'secret') {
      var mood = moodOf(hol);
      what = 'Придумай новую скрытую задачу-сюрприз. Настроение — ' + mood.name + ': ' + mood.rule + '. ' + SECRET_RULES;
    } else if (x.kind === 'classic') {
      what = 'Предложи другую классическую традицию этого праздника' + (placeLine(st) ? ' для места: ' + placeLine(st) : '') + ', которая подходит к направлению истории.';
    } else {
      what = 'Придумай другую открытую праздничную задачу, связанную с праздником и с персонажами, отношениями, происходящим в истории. Лёгкую, выполнимую за пару сцен.';
    }
    return [
      '[OOC: Пауза в ролевой игре. Ты — помощник автора. Праздник: ' + hol.name + '.',
      direction ? direction + '\n' : '',
      x.kind === 'secret' ? 'Игроку нужна другая секретная задача.' : 'Игроку не подошла задача «' + x.text + '».',
      what,
      others ? 'Не повторяй остальные задачи: ' + others + '.' : '',
      'Ответь ровно одной строкой:',
      'TASK: текст задачи для ' + names.user + ']'
    ].filter(Boolean).join('\n');
  }

  function applyTaskReroll(hol, idx, raw) {
    var m = cleanLine(raw).match(/(?:TASK|SECRET|STORY)\s*[:：—–-]\s*(.+)/i);
    var x = hol.tasks[idx];
    if (!m || !x) return false;
    x.text = m[1].trim().replace(/\]$/, '');
    x.done = false;
    return true;
  }

  function whenText(hol, today) {
    if (today < hol.start) {
      var d = daysBetween(today, hol.start);
      return d === 1 ? 'завтра' : 'через ' + daysWord(d);
    }
    if (today > hol.end) return 'уже прошёл';
    return hol.start === hol.end ? 'сегодня' : 'идёт сейчас';
  }

  // Блок праздника для обычных ответов модели
  function buildHolidayInjection(st) {
    ensureHolidayState(st);
    var out = [];
    var hol = st.holiday;
    var today = st.time.date;
    if (hol && !hol.finished && today) {
      var lines = ['[Праздничное событие: ' + hol.emoji + ' ' + hol.name + ' — ' + whenText(hol, today) + '.'];
      if (hol.vibe) lines.push('Атмосфера вокруг: ' + hol.vibe + '.');
      var open = hol.tasks.map(function (x, i) { return { x: x, n: i + 1 }; }).filter(function (o) { return !o.x.hidden; });
      lines.push('Праздничные традиции, которые игрок может выполнить (персонажи могут предлагать, но не навязывай):');
      open.forEach(function (o) { lines.push(o.n + '. ' + o.x.text + (o.x.done ? ' — уже сделано' : '')); });
      var sec = hol.tasks.map(function (x, i) { return { x: x, n: i + 1 }; }).filter(function (o) { return o.x.hidden && !o.x.done; });
      if (sec.length) lines.push('Секретная задача (' + moodOf(hol).name + '; игрок о ней не знает; создавай для неё ненавязчивые поводы, не раскрывай прямо; это ситуация, а не сценарий — не диктуй персонажам реплики и чувства): ' + sec.map(function (o) { return o.n + '. ' + o.x.text; }).join('; '));
      lines.push('Служебные метки: если в твоём ответе одна из задач по-настоящему выполнена — допиши в самом конце ответа <!--✓номер-->. Если в ответе наступил следующий день — допиши <!--день+1--> (или +N, если прошло несколько дней). Метки невидимы для игрока; не упоминай их в тексте.]');
      out.push(lines.join('\n'));
    }
    var traces = st.traces.filter(function (x) { return today && today <= x.until; });
    if (traces.length) out.push('[Следы недавних праздников — они ещё заметны в сцене: ' + traces.map(function (x) { return x.text; }).join(' ') + ']');
    if (st.memories.length) out.push('[Воспоминания о прошлых праздниках (персонажи могут на них ссылаться): ' + st.memories.slice(-5).map(function (m) { return m.text; }).join(' ') + ']');
    return out.join('\n\n');
  }

  function fullInjection(st) {
    return [buildTimeInjection(st), buildHolidayInjection(st)].filter(Boolean).join('\n\n');
  }

  // Строки для плановой проверки: подстраховка, если модель забыла поставить метку
  function holidayCheckSection(st) {
    ensureHolidayState(st);
    var hol = st.holiday;
    if (!hol || hol.finished) return '';
    var lines = ['Праздник «' + hol.name + '», задачи:'];
    hol.tasks.forEach(function (x, i) { lines.push((i + 1) + '. ' + x.text + (x.hidden ? ' (секретная)' : '') + (x.done ? ' — выполнено' : '')); });
    lines.push('TASK номер — если задача уже выполнена в чате, но выше не отмечена.');
    return lines.join('\n');
  }

  function markTask(st, n, res) {
    var hol = st.holiday;
    if (!hol || hol.finished) return;
    var x = hol.tasks[Number(n) - 1];
    if (!x || x.done) return;
    x.done = true;
    (res.tasksDone = res.tasksDone || []).push(x);
  }

  // Метки в обычном ответе модели: <!--✓2-->, <!--день+1-->
  var TAG_RE = /<!--\s*(✓|v|done)\s*#?(\d+)\s*-->|<!--\s*(день|day)\s*\+\s*(\d+)\s*-->/gi;
  function applyReplyTags(st, text, res) {
    var m;
    TAG_RE.lastIndex = 0;
    var found = false;
    while ((m = TAG_RE.exec(String(text || '')))) {
      found = true;
      if (m[2]) markTask(st, m[2], res);
      else if (m[4] && st.time.date) {
        var n = Math.min(60, Number(m[4]) || 1);
        st.time.date = addDays(st.time.date, n);
        res.timeMoved = (res.timeMoved || 0) + n;
      }
    }
    return found;
  }
  function stripTags(text) {
    return String(text || '').replace(TAG_RE, '').replace(/\s+$/, '');
  }

  function tierOf(hol) {
    var open = hol.tasks.filter(function (x) { return !x.hidden; });
    var done = open.filter(function (x) { return x.done; }).length;
    var secret = hol.tasks.some(function (x) { return x.hidden && x.done; });
    var share = open.length ? done / open.length : 0;
    var tier = done === 0 ? 'anti' : share < 0.5 ? 'bronze' : share < 1 ? 'silver' : 'gold';
    return { tier: tier, done: done, total: open.length, secret: secret };
  }
  var TIER_NAMES = { anti: 'антимедаль', bronze: 'бронза', silver: 'серебро', gold: 'золото' };
  var TIER_ICONS = { anti: '🥔', bronze: '🥉', silver: '🥈', gold: '🥇' };

  function finalePrompt(hol, st, names) {
    var t = tierOf(hol);
    return [
      '[OOC: Пауза в ролевой игре. Ты — помощник автора. Праздник «' + hol.name + '» закончился. Перечитай, как он прошёл в чате (если он прошёл за кадром из-за таймскипа — оцени, как он мог пройти).',
      'Задачи праздника: ' + hol.tasks.map(function (x) { return '«' + x.text + '»' + (x.hidden ? ' (секретная)' : '') + ' — ' + (x.done ? 'выполнено' : 'нет'); }).join('; ') + '.',
      'Итог: выполнено ' + t.done + ' из ' + t.total + ' открытых традиций' + (t.secret ? ', и секретная задача тоже' : '') + '. Уровень медали: ' + TIER_NAMES[t.tier] + '.',
      'Ответь ровно тремя строками:',
      'MEDAL: эмодзи | смешное название | одна строка с юмором о том, как ' + names.user + ' на самом деле провёл(а) этот праздник' + (t.tier === 'anti' ? ' (это антимедаль за то, что праздник прошёл мимо)' : ''),
      'OUTCOME: 1–2 предложения о том, как это отразилось на отношениях: кто доволен, кто разочарован. ' + (t.tier === 'anti' || t.tier === 'bronze' ? 'Добавь лёгкие последствия в духе истории.' : 'Отметь, чем праздник запомнится.'),
      'TRACE: что осталось от праздника в ближайшие дни — предмет, фото, остатки еды, следы веселья.]'
    ].join('\n').replace(/\{\{user\}\}/gi, names.user);
  }

  function applyFinale(hol, st, raw) {
    var t = tierOf(hol);
    var text = String(raw || '').replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u2800\u3000\u3164\uFEFF]/g, ' ').replace(/\*\*/g, '');
    var medal = text.match(/MEDAL\s*[:：—–-]\s*(.+)/i);
    var outcome = text.match(/OUTCOME\s*[:：—–-]\s*(.+)/i);
    var trace = text.match(/TRACE\s*[:：—–-]\s*(.+)/i);
    var parts = medal ? medal[1].split('|').map(function (s) { return s.trim(); }) : [];
    var m = {
      emoji: parts[0] || hol.emoji,
      title: parts[1] || (TIER_NAMES[t.tier][0].toUpperCase() + TIER_NAMES[t.tier].slice(1) + ': ' + hol.name),
      desc: parts[2] || ('Выполнено ' + t.done + ' из ' + t.total + ' традиций.'),
      tier: t.tier, secret: t.secret, holiday: hol.name, date: hol.end
    };
    st.medals.push(m);
    var year = hol.end.slice(0, 4);
    if (outcome) st.memories.push({ text: hol.name + ' ' + year + ': ' + outcome[1].trim(), date: hol.end });
    if (st.memories.length > 12) st.memories.splice(0, st.memories.length - 12);
    if (trace) st.traces.push({ text: trace[1].trim(), until: addDays(hol.end, 5) });
    st.traces = st.traces.filter(function (x) { return x.until >= (st.time.date || x.until); });
    hol.finished = true;
    st.holidayDone[hol.key] = true;
    addEvent(st, hol.end, hol.name + ': ' + (outcome ? outcome[1].trim() : 'праздник прошёл') + ' (медаль «' + m.title + '»)');
    return m;
  }

  // Напоминания: за leadDays дней и в сам день — по одному разу
  function dueReminders(st, leadDays) {
    ensureHolidayState(st);
    var out = [];
    if (!st.time.date) return out;
    upcoming(st, leadDays).forEach(function (h) {
      var key = h.name + '|' + h.start;
      var stage = h.ongoing || h.inDays === 0 ? 'today' : 'soon';
      var seen = st.notified[key] || [];
      if (seen.indexOf(stage) >= 0) return;
      seen.push(stage);
      st.notified[key] = seen;
      var tr = traditionsFor(h, st.time.country);
      var emoji = (tr && tr.emoji) || '📅';
      out.push(stage === 'today'
        ? emoji + ' Сегодня — ' + h.name
        : emoji + ' ' + (h.inDays === 1 ? 'Завтра' : 'Через ' + daysWord(h.inDays)) + ' — ' + h.name);
    });
    var keys = Object.keys(st.notified);
    if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(function (k) { delete st.notified[k]; });
    return out;
  }

  // ---------- Движок праздника (общий для всех версий) ----------
  // io: { generate(prompt, withContext) -> текст, toast(text), names, lead, events, showToasts }
  // Меняет st на месте; сохранение — на стороне вызывающего.
  async function holidayProgress(st, io, opts) {
    opts = opts || {};
    ensureHolidayState(st);
    if (!st.time.date) return;
    var reminders = dueReminders(st, io.lead);
    if (io.showToasts) reminders.forEach(function (x) { io.toast(x); });
    if (!io.events) return;
    var hol = st.holiday;
    if (hol && !hol.finished && (opts.finish || st.time.date > hol.end)) {
      var raw = '';
      try { raw = await io.generate(finalePrompt(hol, st, io.names), true); } catch (e) { raw = ''; }
      if (!hol.finished) {
        var medal = applyFinale(hol, st, raw);
        io.toast('🏅 ' + medal.emoji + ' «' + medal.title + '» — ' + medal.desc);
      }
    }
    var found = holidayToActivate(st, io.lead);
    if (found) {
      var h = newHoliday(found);
      var raw2 = '';
      try { raw2 = await io.generate(activationPrompt(h, st, io.names, io.direction || ''), true); } catch (e) { raw2 = ''; }
      applyActivation(h, raw2);
      st.holiday = h;
      var open = h.tasks.filter(function (x) { return !x.hidden; }).length;
      io.toast(h.emoji + ' Праздничное событие: ' + h.name + '\nТрадиций: ' + open + (h.tasks.length > open ? ' + 🔒 секретная (' + moodOf(h).icon + ')' : ''));
    }
  }

  function holidaySummary(res) {
    var out = [];
    (res.tasksDone || []).forEach(function (x) { out.push(x.hidden ? '🔓 Секретная задача выполнена: ' + x.text : '✓ ' + x.text); });
    return out;
  }

  // Дни рождения
  function normNameB(x) { return String(x || '').trim().toLowerCase().replace(/ё/g, 'е'); }

  const INAPPROPRIATE_BDAY_RE = /(?:бывш(?:ая|ий|ее|их|его|ей|ему|им|ую|ею|ими)?|экс[- ]|враг(?:а|у|ом|е|и|ов|ам|ами|ах)?|соперниц(?:а|ы|е|у|ей|ею|ам|ами|ах)?|соперник(?:а|у|ом|е|и|ов|ам|ами|ах)?|недруг(?:а|у|ом|е|и|ов|ам|ами|ах)?|антагонист(?:ка|ки|ке|ку|кой|а|у|ом|е|ы|ов|ам|ами|ах)?|недоброжелател(?:ь|я|ю|ем|е|и|ей|ям|ями|ях)?|предател(?:ь|ница|ницы|нице|ницу|ницей|я|ю|ем|е|и|ей|ям|ями|ях)?|абьюзер(?:а|у|ом|е|ы|ов|ам|ами|ах)?|токсичн(?:ая|ый|ое|ые|ую|ого|ому|ым|ых|ости|ость)?)/i;

  function isHostileOrEx(nameOrNpc, st) {
    if (!nameOrNpc) return false;
    var name = typeof nameOrNpc === 'string' ? nameOrNpc : (nameOrNpc.name || '');
    if (INAPPROPRIATE_BDAY_RE.test(name)) return true;
    var norm = normNameB(name);
    var npc = (st && st.npcs) ? st.npcs.find(function (n) { return normNameB(n.name) === norm; }) : (typeof nameOrNpc === 'object' ? nameOrNpc : null);
    if (npc) {
      if (INAPPROPRIATE_BDAY_RE.test(npc.card || '') || INAPPROPRIATE_BDAY_RE.test(npc.status || '')) return true;
    }
    if (st && st.relationships) {
      var rels = st.relationships.filter(function (r) { return normNameB(r.a) === norm || normNameB(r.b) === norm; });
      for (var i = 0; i < rels.length; i++) {
        var r = rels[i];
        var text = (r.type || '') + ' ' + (r.desc || '');
        if (INAPPROPRIATE_BDAY_RE.test(text)) return true;
        if (/(соперничество|вражда|неприязнь|холодн|ненавист|конфликт)/i.test(text)) return true;
      }
    }
    return false;
  }
  function hasBday(st, who) {
    var k = normNameB(who);
    return st.time.custom.some(function (c) { return c.bday && normNameB(c.who) === k; });
  }
  function bdaySection(st, userName, charNames, npcNames) {
    var known = st.time.custom.filter(function (c) { return c.bday; }).map(function (c) { var md = c.md.split('-').map(Number); return c.who + ' — ' + md[1] + ' ' + MONTHS_GEN[md[0] - 1]; });
    var lines = ['Дни рождения' + (known.length ? ' (уже известны: ' + known.join(', ') + ')' : '') + '.'];
    var missing = [userName].concat(charNames || []).filter(function (n) { return n && !hasBday(st, n); });
    if (missing.length) lines.push('Ещё не заданы для: ' + missing.join(', ') + '. Найди дату в карточке персонажа, описании персоны или в чате; если её нигде нет — придумай правдоподобную, подходящую персонажу.');
    var eligibleNpcs = (npcNames || []).filter(function (n) { return n && !hasBday(st, n) && !isHostileOrEx(n, st); }).slice(0, 8);
    if (eligibleNpcs.length) {
      lines.push('У близких и значимых NPC тоже бывают дни рождения (только друзья, семья, возлюбленные, наставники, добрые коллеги или шеф). Ещё нет дат у: ' + eligibleNpcs.join(', ') + '. Добавь BDAY для одного-двух самых близких из них; если даты в истории нет — придумай. Если понятно, где и как этот персонаж будет праздновать, допиши после даты коротко, например «— отмечает в офисе».');
    }
    lines.push('СТРОГО ЗАПРЕЩЕНО добавлять дни рождения для бывших партнёров (ex), соперников, врагов, антагонистов или токсичных персонажей — такие даты не отмечаются и не являются праздниками.');
    lines.push('BDAY Имя: ДД.ММ — день рождения' + (missing.length || eligibleNpcs.length ? ' (только для близких персонажей из перечисленных выше; не больше двух NPC за раз)' : ' близкого и важного для сюжета NPC') + '.');
    return lines.join('\n');
  }
  // Команды TASK и BDAY. Возвращает true, если строка распознана.
  function applyEventCommand(st, line, res) {
    var m = line.match(/^TASK\s*✓?\s*#?\s*(\d+)/i);
    if (m) { markTask(st, m[1], res); return true; }
    m = line.match(/^BDAY\s*[:：]?\s*\[?([^\]:：]{1,60}?)\]?\s*[:：—–-]\s*(.+)$/i);
    if (m) {
      var who = m[1].trim();
      if (isHostileOrEx(who, st)) return true;
      var iso = parseDateText(m[2], '2000-01-01');
      if (iso && !hasBday(st, who) && (res.bdays || []).length < 4) {
        var note = (m[2].match(/\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{2,4})?\s*[—–-]\s*(.+)$/) || [])[1] || '';
        var entry = { name: 'День рождения: ' + who, md: iso.slice(5), bday: true, who: who };
        if (note) entry.note = note.trim().replace(/\]$/, '');
        st.time.custom.push(entry);
        (res.bdays = res.bdays || []).push(who);
      }
      return true;
    }
    return false;
  }


const GENRES = ['Комедия', 'Повседневность', 'Романтика', 'Эротика', 'Драма', 'Ангст', 'Приключения', 'Экшн', 'Мистика', 'Ужасы', 'Детектив'];

const defaults = {
    enabled: true,
    actionPrompts: true,
    interval: 12,
    depth: 4,
    role: 0,
    maxActive: 12,
    maxIntrigues: 5,
    maxNpcs: 20,
    maxArcs: 6,
    minStimuli: 2,
    events: true,
    leadDays: 3,
    ffButton: true,
    wardrobeImages: true,
    accents: true,
    mesButtons: true,
    imageSource: '',
    imgApiBase: 'https://api.linkapi.ai/v1',
    imgApiKey: '',
    imgApiModel: 'gpt-image-2-c',
    imgApiSize: '1536x1024',
    imgOrientation: 'portrait',
    imageRef: true,
    showToasts: true,
    hideSpoilers: false,
    thinkPrompt: DEFAULT_THINK,
    injectPrompt: DEFAULT_INJECT,
};

let busy = false;

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE]) all[MODULE] = structuredClone(defaults);
    for (const k of Object.keys(defaults)) {
        if (all[MODULE][k] === undefined) all[MODULE][k] = defaults[k];
    }
    const s = all[MODULE];
    // Обновляем сохранённый стандартный промпт из старых версий (он не содержал новых разделов)
    if ((s.promptVersion || 0) < 2) {
        if (s.thinkPrompt.includes('Пауза в ролевой игре') && !s.thinkPrompt.includes('{{npcs}}')) {
            s.thinkPrompt = DEFAULT_THINK;
        }
        s.promptVersion = 2;
        ctx().saveSettingsDebounced();
    }
    if (s.promptVersion < 3) {
        // стандартный промпт v2 → v3 (добавлен раздел времени и места)
        if (s.thinkPrompt.includes('ведёшь свой рабочий блокнот') && !s.thinkPrompt.includes('{{time}}')) {
            s.thinkPrompt = DEFAULT_THINK;
        }
        s.promptVersion = 3;
        ctx().saveSettingsDebounced();
    }
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

// Хранилище текущего чата (null, если чат не открыт)
function store() {
    const c = ctx();
    if (!c.chatId || !c.chatMetadata) return null;
    if (!c.chatMetadata[MODULE]) {
        c.chatMetadata[MODULE] = {
            notes: [],
            archive: [],
            nextId: 1,
            lastThinkAt: c.chat?.length ?? 0,
            lastRaw: '',
        };
    }
    const st = c.chatMetadata[MODULE];
    if (!st.direction) st.direction = { genres: [], customGenre: '', inspiration: '' };
    if (!st.direction.mixMode) st.direction.mixMode = 'and';
    if (typeof st.direction.avoid !== 'string') st.direction.avoid = '';
    if (st.direction.intrigues === undefined) st.direction.intrigues = true;
    if (!st.rejected) st.rejected = [];
    if (!st.intrigues) st.intrigues = [];
    if (!st.nextIntrigueId) st.nextIntrigueId = 1;
    if (st.direction.npcs === undefined) st.direction.npcs = true;
    if (!st.npcs) st.npcs = [];
    if (!st.nextNpcId) st.nextNpcId = 1;
    if (st.direction.arcs === undefined) st.direction.arcs = true;
    if (!st.arcs) st.arcs = [];
    if (!st.evolved) st.evolved = [];
    if (!st.nextArcId) st.nextArcId = 1;
    if (!Array.isArray(st.relationships)) st.relationships = [];
    if (!st.nextRelId) st.nextRelId = 1;
    if (st.direction.time === undefined) st.direction.time = true;
    if (!st.time) st.time = { date: '', country: '', countryName: '', city: '', flavor: '', flavorLocked: false, custom: [] };
    if (!Array.isArray(st.time.custom)) st.time.custom = [];
    if (!Array.isArray(st.time.timeline)) st.time.timeline = [];
    if (typeof st.direction.lines !== 'string') st.direction.lines = '';
    if (st.direction.wardrobe === undefined) st.direction.wardrobe = true;
    if (!st.wardrobe || typeof st.wardrobe !== 'object') st.wardrobe = { active: null, history: [] };
    if (!Array.isArray(st.wardrobe.history)) st.wardrobe.history = [];
    if (!Array.isArray(st.wardrobe.box)) st.wardrobe.box = [];
    if (!Array.isArray(st.wardrobe.closet)) st.wardrobe.closet = [];
    if (!st.wardrobe.nextClosetId) st.wardrobe.nextClosetId = 1;
    if (!Array.isArray(st.wardrobe.equipped)) st.wardrobe.equipped = [];
    if (!st.wardrobe.nextItemId) st.wardrobe.nextItemId = 1;
    if (st.worldProfile === undefined) st.worldProfile = null;
    if (st.direction.gacha === undefined) st.direction.gacha = true;
    if (!st.gacha || typeof st.gacha !== 'object') st.gacha = { active: null, pity: 0, spins: [], pending: null, total: 0, choices: [], nextChoiceId: 1 };
    if (!Array.isArray(st.gacha.spins)) st.gacha.spins = [];
    if (!Array.isArray(st.gacha.choices)) st.gacha.choices = [];
    if (!st.gacha.nextChoiceId) st.gacha.nextChoiceId = 1;
    if (st.direction.map === undefined) st.direction.map = true;
    if (st.direction.livingWorld === undefined) st.direction.livingWorld = true;
    if (!st.map || typeof st.map !== 'object') st.map = { places: [], current: null, nextId: 1 };
    if (!Array.isArray(st.map.places)) st.map.places = [];
    ensureHolidayState(st);
    return st;
}

function formatNotes(notes) {
    if (!notes.length) return '(пока пусто)';
    const len = ctx().chat?.length ?? 0;
    return notes
        .map(n => `#${n.id}${n.tag ? ` [${n.tag}]` : ''} (записано ${Math.max(0, len - n.at)} сообщ. назад${n.ff ? ', ⏩ уже начата в чате' : ''}): ${n.text}`)
        .join('\n');
}

function buildDirection(st) {
    const parts = [buildGenreDirection(st)];
    if (st?.rejected?.length) {
        parts.push('Игрок отклонил эти идеи — не предлагай их и похожие:\n' + st.rejected.map(t => `— ${t}`).join('\n'));
    }
    return parts.filter(Boolean).join('\n\n');
}

function buildGenreDirection(st) {
    const d = st?.direction;
    if (!d) return '';
    const genres = [...d.genres];
    const custom = d.customGenre?.trim();
    if (custom) genres.push(custom);
    const declared = d.lines?.trim();
    if (!genres.length && !declared) return '';
    const lines = ['НАПРАВЛЕНИЕ ИСТОРИИ — главное правило для всех разделов блокнота (задумок, тайн, развития):'];
    const hint = g => GENRE_HINTS[g] ? `${g} (${GENRE_HINTS[g]})` : g;
    if (genres.length === 1) {
        lines.push(`— жанр: ${hint(genres[0])}.`);
    } else if (genres.length > 1 && d.mixMode === 'or') {
        lines.push(`— жанры: ${genres.map(hint).join('; ')}. Каждая задумка — в ОДНОМ из этих жанров, не смешивай их внутри одной идеи; чередуй жанры между задумками.`);
    } else if (genres.length > 1) {
        lines.push(`— жанры: ${genres.map(hint).join('; ')}. Каждая задумка должна сочетать эти жанры одновременно.`);
    }
    if (genres.length) {
        lines.push('— жанр определяет, из чего строятся задумки и какие в них ставки. Предлагай только то, что работает на выбранный жанр. Не тащи элементы чужих жанров: если выбраны лёгкие жанры, не вводи внешние угрозы, бюрократию, преследование, опасность — конфликты должны быть мелкими, личными и решаемыми.');
        lines.push('— тайны, слухи и интриги уместны в любом жанре — меняется только их характер. В комедии и повседневности это сплетни соседей, нелепые слухи, недоразумения, секрет ради сюрприза, чьи-то тайные привычки; в романтике — тайный поклонник, слухи о романе, интрижки, ревность, скрытые чувства. Запрет на угрозы и опасность не отменяет интриги — просто делай их лёгкими.');
    }
    if (declared) lines.push(`— ЗАЯВЛЕННЫЕ ЛИНИИ — игрок хочет видеть их в истории: ${declared}. Держи их живыми: заводи для них арки, тайны, слухи и задумки и периодически возвращай этих персонажей в сюжет, даже если о них давно не было речи.`);
    lines.push('Не ломай логику уже идущей истории.');
    return lines.join('\n');
}

function formatIntrigues(list) {
    if (!list.length) return '(пока нет)';
    const len = ctx().chat?.length ?? 0;
    return list.map(it => {
        let line = `T${it.id}${it.tag ? ` [${it.tag}]` : ''} (заведено ${Math.max(0, len - it.at)} сообщ. назад): ${it.text}`;
        line += it.clues.length
            ? '\n   Уже открылось игроку: ' + it.clues.map(c => c.text).join('; ')
            : '\n   Игрок пока ничего об этом не знает.';
        return line;
    }).join('\n');
}

function normName(x) {
    return String(x || '').trim().toLowerCase().replaceAll('ё', 'е');
}

function findNpc(st, name) {
    const key = normName(name);
    return st.npcs.find(n => normName(n.name) === key);
}

function findRel(st, a, b) {
    const na = normName(a), nb = normName(b);
    return (st.relationships || []).find(r => {
        const ra = normName(r.a), rb = normName(r.b);
        if (r.arrow === '→') return ra === na && rb === nb;
        return (ra === na && rb === nb) || (ra === nb && rb === na);
    });
}

const REL_INJECT_HEADER = '[Отношения и связи между персонажами — канон их динамики. Держись этих линий в разговорах, взглядах, симпатиях и спорах.]';

function formatRelationships(st, forThink = false) {
    const list = st.relationships || [];
    if (!list.length) return '(пока нет)';
    return list.map(r => {
        const arrow = r.arrow || '↔';
        const typeStr = r.type ? ` [${r.type}]` : '';
        if (forThink) {
            let line = `R${r.id} ${r.a} ${arrow} ${r.b}${typeStr}: ${r.desc || ''}`;
            if (r.locked) line += ' (правлено вручную — не меняй)';
            return line;
        }
        return `— ${r.a} ${arrow} ${r.b}${typeStr}: ${r.desc || ''}`;
    }).join('\n');
}

function formatNpcs(list, forThink = false) {
    if (!list.length) return '(пока нет)';
    const sorted = [...list].sort((a, b) => (!!b.favorite - !!a.favorite) || a.id - b.id);
    return sorted.map(n => {
        const favTag = n.favorite ? ' [❤️ ГЛАВНЫЙ ГЕРОЙ / ФАВОРИТ ИГРОКА — ключевая фигура истории и романтического/сюжетного внимания]' : '';
        let line = `— ${n.name}${favTag}: ${n.card}`;
        if (forThink && n.locked) line += ' (карточку правил игрок — не меняй её, только NPCSTATE)';
        if (n.status) line += `\n   Сейчас: ${n.status}`;
        return line;
    }).join('\n');
}

function buildNpcSection(st) {
    if (!st?.direction?.npcs) return '';
    return `Персонажи (NPC) и их связи. Ты ведёшь краткие карточки значимых NPC и динамику отношений между ними — это канон истории.

Текущие карточки:
${formatNpcs(st.npcs, true)}

Связи и отношения между персонажами:
${formatRelationships(st, true)}

Команды для них (с новой строки, вместе с остальными):
NPC [Имя]: кто это, внешность, характер, отношение к {{user}} — 1–3 предложения. Для нового NPC или если в истории изменилось что-то постоянное.
NPCSTATE [Имя]: где он сейчас и что с ним происходит — коротко.
REL [Имя1 ↔ Имя2]: тип | как относятся друг к другу / что между ними — взаимная связь (дружба, роман, соперничество, семейные узы, тайный союз).
REL [Имя1 → Имя2]: тип | отношение с одной стороны (безответная влюблённость, тайная ревность, подозрение, зависть, долг).
DROP #R1 — если связь распалась или потеряла сюжетное значение.
Если у значимого NPC из чата ещё нет карточки — обязательно заведи её. Заводи только NPC, которые реально появились в чате и важны для истории. Не заводи карточки для {{char}} и {{user}}. Отношения между NPC и {{char}}/{{user}} тоже можно фиксировать через REL. Тайные мотивы сюда не пиши — для них есть тайны. Карточки и связи не считаются в лимит новых записей.`;
}

function formatArcs(st, forThink = false) {
    const need = Math.max(1, Number(settings().minStimuli) || 2);
    const lines = st.arcs.map(a => {
        const stg = ARC_STAGES[a.stage];
        let line = forThink
            ? `A${a.id} ${a.who}: ${a.text}. Стадия ${a.stage}/${ARC_MAX} (${stg.name}).`
            : `${a.who} — ${a.text}. Стадия ${a.stage}/${ARC_MAX} «${stg.name}»: ${stg.hint}.`;
        if (a.current) line += ` Сейчас: ${a.current}`;
        if (forThink) {
            line += `\n   Стимулов с прошлого сдвига: ${a.sinceShift} из ${need} нужных.`;
            if (a.stimuli.length) line += '\n   Стимулы: ' + a.stimuli.map(x => x.text).join('; ');
        }
        return line;
    });
    if (st.evolved.length) {
        lines.push('Закреплённые изменения:\n' + st.evolved.map(e => `— ${e.who}: ${e.text}`).join('\n'));
    }
    return lines.length ? lines.join('\n') : '(пока нет)';
}

// Если все арки касаются только главного персонажа — подталкиваем модель к NPC
function npcArcNudge(st) {
    const charName = ctx().name2 || '';
    const norm = x => String(x || '').toLowerCase().replace(/ё/g, 'е');
    const arcsAboutNpc = st.arcs.filter(a => norm(a.who) !== norm(charName)).length;
    if (arcsAboutNpc || !st.npcs.length) return '';
    return `\nСейчас ни одной арки нет ни у NPC, ни у их отношений. Посмотри на карточки NPC (${st.npcs.slice(0, 6).map(n => n.name).join(', ')}) и на линии между ними — заведи арку хотя бы для одной, если в истории для неё есть почва.\n`;
}

function buildArcSection(st) {
    if (!st?.direction?.arcs) return '';
    const need = Math.max(1, Number(settings().minStimuli) || 2);
    const stages = ARC_STAGES.slice(1).map((x, i) => `${i + 1}. ${x.name} — ${x.hint}`).join('\n');
    return `Развитие персонажей. Характеры не статичны: под влиянием событий персонажи, включая {{char}}, могут меняться — в лучшую или в худшую сторону. Карточка персонажа описывает, каким он был в начале истории.

Стадии развития:
${stages}

Текущие арки:
${formatArcs(st, true)}
${npcArcNudge(st)}
Команды для них (с новой строки, вместе с остальными):
ARC [Имя]: черта сейчас → во что может развиться. Если персонаж уже заметно меняется под влиянием событий или отношений — заведи арку; если почвы нет — не выдумывай.
ARC [Имя + Имя]: как сейчас устроены их отношения → куда они могут прийти. Так же веди линии отношений между NPC: дружба, соперничество, роман, любовный треугольник (тогда указывай всех троих).
Арки бывают не только у {{char}}: значимые NPC и их отношения друг с другом тоже меняются, даже когда {{user}} не рядом. Особенно держи линии, о которых игрок прямо заявлял (например, «у них будет любовный треугольник»).
STIMULUS #A1: что в чате подтолкнуло изменение (только то, что действительно произошло)
SHIFT #A1: как теперь проявляется характер — переход на следующую стадию. Возможен, только когда с прошлого сдвига накопилось не меньше ${need} стимулов.
REGRESS #A1: что отбросило персонажа назад
DROP #A1 — арка больше не актуальна
Изменения должны быть заслуженными и постепенными. Не меняй ядро личности: грубиян может научиться заботе, но остаётся собой — с тем же юмором, манерой речи и привычками. Конец арки — один заметный шаг роста, а не другая личность: черты, на которых держится характер (тревожность, застенчивость, вспыльчивость, лень и т.п.), смягчаются, но не исчезают. Формулируй цель так: «всё ещё [прежняя черта], но [что изменилось]», а не «уверенный», «раскрепощённый», «бесстрашный». Арки не считаются в лимит новых записей.`;
}

function buildIntrigueSection(st) {
    if (!st?.direction?.intrigues) return '';
    const max = Math.max(1, Number(settings().maxIntrigues) || 5);
    return `Тайны и интриги. Параллельно задумкам ты ведёшь скрытые сюжетные линии: тайны, загадки, слухи (правдивые или ложные), заговоры и интриги NPC. Записывай суть так, как её знает только автор. Это касается не только {{char}} и {{user}}: у NPC свои секреты, романы и сплетни друг о друге — их тоже заводи.

Текущие тайны:
${formatIntrigues(st.intrigues)}

Команды для них (с новой строки, вместе с остальными):
INTRIGUE [тайна|загадка|слух|интрига]: в чём правда на самом деле
CLUE #T1: что из этой тайны уже прозвучало или открылось в чате (только то, что действительно было)
SOLVED #T1 — тайна раскрыта
DROP #T1 — линия больше не нужна
${st.intrigues.length ? 'Новую тайну заводи, если она по-настоящему обогатит историю.' : 'Сейчас у истории нет ни одной тайны — заведи хотя бы одну, подходящую к жанру и происходящему.'} Одновременно держи не больше ${max}.`;
}

function fillTemplate(template, notes, direction = '', intrigues = '', npcs = '', arcs = '', time = '', wardrobe = '') {
    const c = ctx();
    const MARK = '\u0001NNB_NOTES\u0001';
    const DMARK = '\u0001NNB_DIR\u0001';
    const IMARK = '\u0001NNB_INT\u0001';
    const NMARK = '\u0001NNB_NPC\u0001';
    const AMARK = '\u0001NNB_ARC\u0001';
    const TMARK = '\u0001NNB_TIME\u0001';
    const WMARK = '\u0001NNB_WARD\u0001';
    const withMark = c.substituteParams(template
        .replaceAll('{{notes}}', MARK)
        .replaceAll('{{direction}}', DMARK)
        .replaceAll('{{intrigues}}', IMARK)
        .replaceAll('{{npcs}}', NMARK)
        .replaceAll('{{arcs}}', AMARK)
        .replaceAll('{{time}}', TMARK)
        .replaceAll('{{wardrobe}}', WMARK));
    return withMark
        .replaceAll(MARK, formatNotes(notes))
        .replaceAll(DMARK, direction)
        .replaceAll(IMARK, intrigues)
        .replaceAll(NMARK, c.substituteParams(npcs))
        .replaceAll(AMARK, c.substituteParams(arcs))
        .replaceAll(TMARK, c.substituteParams(time))
        .replaceAll(WMARK, c.substituteParams(wardrobe))
        .replace(/\n{3,}/g, '\n\n');
}


function livingWorldOn(st) {
    return st?.direction?.livingWorld !== false;
}

function buildWorldProfileInjection(st) {
    const wp = st?.worldProfile;
    if (!wp) return '';
    const user = storyNames().user;
    const parts = [`[Профиль мира и персонажа (${user}) — канон истории:`];
    if (wp.home) parts.push(`— Жильё ${user}: ${wp.home}.`);
    if (wp.startVibe) parts.push(`— Точка старта: ${wp.startVibe}.`);
    if (wp.job) parts.push(`— Профессия / занятие ${user}: ${wp.job}.`);
    if (Array.isArray(wp.hobbies) && wp.hobbies.length) parts.push(`— Хобби и увлечения ${user}: ${wp.hobbies.join(', ')}.`);
    if (wp.wealth) parts.push(`— Достаток: ${wp.wealth}.`);
    if (wp.pet && wp.pet !== 'Без питомца') parts.push(`— Домашний питомец: ${wp.pet}.`);
    if (wp.freeWorld) {
        const favs = (st.npcs || []).filter(n => n.favorite).map(n => n.name);
        if (favs.length) {
            parts.push(`— Свободная игра в мир: главный фокус и романтический/сюжетный интерес ${user} сейчас связан с фаворитом из блокнота (${favs.join(', ')}). Мир остаётся живым и открытым для исследования.`);
        } else {
            parts.push(`— Свободная игра в мир (без привязки к одному стартовому фавориту): не привязывай ${user} наручниками к одному персонажу в каждой сцене. Давай ${user} свободно исследовать мир, жить своей жизнью, общаться с разными людьми и встречать потенциальные симпатии по ходу сюжета.`);
        }
    } else if (wp.charRel && wp.charRel !== 'По первому сообщению чата') {
        parts.push(`— Стартовая связь с основным персонажем: ${wp.charRel}.`);
    }
    return parts.join('\n') + ']';
}

function buildLivingWorldInjection(st) {
    const profBlock = buildWorldProfileInjection(st);
    if (!st || !livingWorldOn(st)) return profBlock;
    const curPlace = mapOn(st) && st.map?.current ? st.map.places.find(p => p.id === st.map.current) : null;
    const locLine = curPlace
        ? `Текущая локация: «${curPlace.title}»${curPlace.desc ? ` (${curPlace.desc})` : ''}${curPlace.hooks ? `. Зацепки и крючки этого места: ${curPlace.hooks}` : ''}.\n`
        : '';
    const lwBlock = `[Живой мир — окружение рассказывает истории:
${locLine}Не описывай локации как просто красивое полотно или статичный фон. Мир вокруг живёт своей жизнью и подбрасывает истории:
— При входе в локацию или смене места сразу вплетай в сцену 2–3 конкретные точки интереса (живые крючки): любопытную деталь или след чужой истории (забытую вещь, необычное объявление, закрытую дверь, странную мелочь), колоритного фонового персонажа за своим занятием или обрывок чужого разговора / микро-сценку поблизости.
— Пусть у мест чувствуется характер, маленькая тайна, местная байка или странность, которую игрок может исследовать, если захочет обратить на неё внимание.]`;
    return [profBlock, lwBlock].filter(Boolean).join('\n\n');
}

function buildActionPromptsInjection() {
    const user = storyNames().user;
    const st = store();
    const poiLine = (st && livingWorldOn(st))
        ? `\n— Если в сцене есть точки интереса, необычные детали окружения, фоновые сценки или зацепки локации, хотя бы один из вариантов должен предлагать ${user} изучить, осмотреть или обыграть этот крючок мира.`
        : '';
    return `[Подсказки действий: в самом конце своего ответа добавь одну скрытую служебную строку с тремя вариантами следующего хода для игрока (${user}) — что может сделать или сказать САМА ${user} в ответ на происходящее:
<!--ACTIONS: вариант 1 | вариант 2 | вариант 3-->
Требования к вариантам:
— Все 3 варианта — это действия и реплики САМОЙ ${user} (что сделает или скажет ${user}), а НЕ других персонажей по отношению к ней! Никаких «протянуть ${user}», «спросить у ${user}», «погладить ${user}» — действует только сама ${user}.
— Три варианта должны существенно отличаться друг от друга по смыслу и тону (не быть перефразировкой одной мысли).
— Каждый вариант ведёт сцену в другое русло: сочетай разные формы (прямая речь от ${user}, физическое действие или жест, пауза/молчание, смена темы, неожиданная реакция).${poiLine}
— Формулируй кратко (1–2 фразы), чтобы ${user} могла отправить этот вариант как свой ход. Метка невидима для игрока, не упоминай её в основном тексте ответа.]`;
}

function updateInjection() {
    const c = ctx();
    const s = settings();
    const st = store();
    const showIntrigues = st?.direction?.intrigues && st.intrigues.length;
    const showNpcs = st?.direction?.npcs && st.npcs.length;
    const showRels = st?.direction?.npcs && (st.relationships || []).length;
    const showArcs = st?.direction?.arcs && (st.arcs.length || st.evolved.length);
    const timeBlock = st && st.direction.time ? [buildTimeInjection(st), s.events ? buildHolidayInjection(st) : ''].filter(Boolean).join('\n\n') : '';
    const livingBlock = st ? buildLivingWorldInjection(st) : '';
    const linesBlock = st?.direction?.lines?.trim() ? `[Линии, которые игрок хочет видеть в истории: ${st.direction.lines.trim()}. Время от времени давай им проявиться: эти персонажи появляются, их отношения развиваются, о них говорят. Естественно и не в каждой сцене.]` : '';
    const wardBlock = st ? [wardrobeInjection(st), gachaInjection(st)].filter(Boolean).join('\n\n') : '';
    const actionBlock = (s.actionPrompts && st) ? buildActionPromptsInjection() : '';
    if (!s.enabled || !st || (!st.notes.length && !showIntrigues && !showNpcs && !showRels && !showArcs && !timeBlock && !livingBlock && !linesBlock && !wardBlock && !actionBlock)) {
        c.setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
        return;
    }
    const blocks = [];
    if (timeBlock) blocks.push(timeBlock);
    if (livingBlock) blocks.push(livingBlock);
    if (wardBlock) blocks.push(wardBlock);
    if (linesBlock) blocks.push(linesBlock);
    if (showNpcs) blocks.push(NPC_INJECT_HEADER + '\n' + formatNpcs(st.npcs));
    if (showRels) blocks.push(REL_INJECT_HEADER + '\n' + formatRelationships(st));
    if (showArcs) blocks.push(ARC_INJECT_HEADER + '\n' + formatArcs(st));
    if (st.notes.length) blocks.push(fillTemplate(s.injectPrompt, st.notes));
    if (showIntrigues) blocks.push(INTRIGUE_INJECT_HEADER + '\n' + formatIntrigues(st.intrigues));
    c.setExtensionPrompt(
        INJECT_KEY,
        blocks.join('\n\n'),
        POS_IN_CHAT,
        Number(s.depth) || 0,
        false,
        Number(s.role) || 0,
    );
    if (!s.enabled || !s.actionPrompts || !st) {
        c.setExtensionPrompt(ACTION_INJECT_KEY, '', POS_IN_CHAT, 0);
    } else {
        c.setExtensionPrompt(
            ACTION_INJECT_KEY,
            buildActionPromptsInjection(),
            POS_IN_CHAT,
            0,
            false,
            Number(s.role) || 0,
        );
    }
}

// Совместимость со старой и новой сигнатурой generateQuietPrompt
let ownRequest = false;
let ownPrompt = '';
let ffPending = false;

async function quietGenerateOnce(prompt) {
    const fn = ctx().generateQuietPrompt;
    ownRequest = true;
    ownPrompt = String(prompt || '');
    try {
        if (fn.length === 0) {
            return await fn({ quietPrompt: prompt });
        }
        return await fn(prompt, false, false);
    } finally {
        ownRequest = false;
        ownPrompt = '';
    }
}

// Таверна добавляет скрытый промпт в конец как системное сообщение. Gemini через
// OpenAI-совместимый прокси без постобработки промпта на этом падает (Bad Request),
// поэтому в наших запросах делаем его сообщением пользователя.
const OWN_MARKER = '[OOC: Пауза в ролевой игре';
function msgContentText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('');
    return '';
}
function fixOwnPromptRole(data) {
    if (!data || data.dryRun || !Array.isArray(data.chat)) return;
    // свой запрос узнаём по началу его текста (не все наши промпты начинаются с OOC-пометки)
    const marker = ownRequest ? (ownPrompt.slice(0, 60) || OWN_MARKER) : ffPending ? FF_MARKER : null;
    if (!marker) return;
    const msgs = data.chat;
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        const contentStr = msgContentText(m?.content);
        if (!contentStr || !contentStr.includes(marker)) continue;
        if (m.role !== 'system') return;
        const prev = msgs[i - 1];
        if (prev && prev.role === 'user' && typeof prev.content === 'string' && typeof m.content === 'string') {
            prev.content += '\n\n' + m.content;
            msgs.splice(i, 1);
        } else {
            m.role = 'user';
            delete m.name;
        }
        return;
    }
}

// Модели иногда ставят вместо пробелов невидимые символы (⠀, неразрывный пробел и т.п.) —
// приводим их к обычным пробелам, иначе команды не распознаются
const ODD_SPACES = /[   -​  ⠀　ㅤ﻿]/g;
function normalizeSpaces(t) {
    return String(t ?? '').replace(ODD_SPACES, ' ');
}

async function quietGenerate(prompt) {
    return normalizeSpaces(await quietGenerateRetry(prompt));
}

// При ошибке лимита (429) ждём и пробуем ещё раз
async function quietGenerateRetry(prompt) {
    try {
        return await quietGenerateOnce(prompt);
    } catch (err) {
        const msg = String(err?.message || err);
        if (!/429|too many|rate|exhausted|quota/i.test(msg)) throw err;
        setStatus('Лимит запросов — жду 30 секунд и пробую ещё раз…');
        toastr.info('Лимит запросов у провайдера. Повторю через 30 секунд.', 'Блокнот рассказчика');
        await new Promise(r => setTimeout(r, 30000));
        return await quietGenerateOnce(prompt);
    }
}

// Модели иногда пишут тег без скобок: «ADD план: …», «INTRIGUE слух — …». Приводим к «ADD [план]: …».
function bracketTag(line) {
    return line.replace(/^(ADD|INTRIGUE|ITEM)\s+([^\s\[\]:：—–-]{1,20})\s*([:：—–-])/i, '$1 [$2]$3');
}

function parseAndApply(raw) {
    const st = store();
    const s = settings();
    const len = ctx().chat.length;
    const res = { added: [], done: [], dropped: [], intrigues: [], clues: 0, solved: 0 };
    const intriguesOn = !!st.direction?.intrigues;
    const npcsOn = !!st.direction?.npcs;
    res.npcNew = 0;
    res.npcUpd = 0;
    res.relNew = 0;
    res.relUpd = 0;
    const arcsOn = !!st.direction?.arcs;
    const need = Math.max(1, Number(s.minStimuli) || 2);
    Object.assign(res, { arcNew: 0, stimuli: 0, shifts: 0, evolved: 0, regress: 0 });
    const findArc = n => st.arcs.find(a => a.id === Number(n));

    const text = String(raw || '')
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
        .replace(/\*\*/g, '')
        .trim();

    if (!text || /^NONE[.!]?$/i.test(text)) return res;

    for (let line of text.split('\n')) {
        line = bracketTag(line.trim().replace(/^[-*•>\s]+/, '').replace(/^`+|`+$/g, ''));
        if (!line) continue;
        if (applyTimeCommand(st, line, res)) continue;
        if (st.direction.time && applyEventCommand(st, line, res)) continue;

        const mi = line.match(/^ITEM\s*(?:\[([^\]]{1,30})\])?\s*[:：—–-]\s*(.+)$/i);
        if (mi) {
            if (accentsOn(st)) {
                const [title, ...rest] = mi[2].split(/\s[—–-]\s/);
                const t = title.trim().replace(/^[«"]|[»"]$/g, '').replace(/\]$/, '');
                if (t && !st.wardrobe.box.some(x => x.title.toLowerCase() === t.toLowerCase()) && st.wardrobe.box.length < 30) {
                    st.wardrobe.box.push({ id: st.wardrobe.nextItemId++, kind: accentKind(mi[1] || t), title: t, desc: '', origin: rest.join(' — ').trim().replace(/\]$/, ''), at: len });
                    (res.items = res.items || []).push(t);
                }
            }
            continue;
        }
        const mp = line.match(/^MAP\s*[:：—–-]\s*(.+)$/i);
        if (mp) {
            if (st.direction.map) { const pl = addPlace(st, mp[1], 'story'); if (pl) (res.places = res.places || []).push(pl.title); }
            continue;
        }
        const mh = line.match(/^HERE\s*[:：—–-]\s*(.+)$/i);
        if (mh) {
            if (st.direction.map) { const pl = findPlace(st, mh[1].split('|')[0]); if (pl) st.map.current = pl.id; }
            continue;
        }
        if (/^OUTFIT\s*_?\s*DONE\b/i.test(line)) {
            res.outfitDone = true;
            continue;
        }
        const mo = line.match(/^OUTFIT\s*[:：—–-]\s*(.+)$/i);
        if (mo) {
            res.outfit = mo[1].trim().replace(/\]$/, '');
            continue;
        }

        let m = line.match(/^ADD\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const note = { id: st.nextId++, tag: (m[1] || '').trim(), text: m[2].trim(), at: len };
            st.notes.push(note);
            res.added.push(note);
            continue;
        }

        m = line.match(/^ARC(?=[\s\[:：])\s*[:：]?\s*\[?([^\]:：—–\n]{1,60}?)\]?\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/i);
        if (m) {
            if (arcsOn && st.arcs.length < (Number(s.maxArcs) || 6)) {
                st.arcs.push({ id: st.nextArcId++, who: m[1].trim(), text: m[2].trim(), stage: 1, current: '', stimuli: [], sinceShift: 0, at: len });
                res.arcNew++;
            }
            continue;
        }

        m = line.match(/^STIMULUS\s*#?\s*A\s*(\d+)\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const a = arcsOn && findArc(m[1]);
            if (a) {
                a.stimuli.push({ text: m[2].trim(), at: len });
                if (a.stimuli.length > 6) a.stimuli.shift();
                a.sinceShift++;
                res.stimuli++;
            }
            continue;
        }

        m = line.match(/^(SHIFT|REGRESS)\s*#?\s*A\s*(\d+)\s*[:：—–-]?\s*(.*)$/i);
        if (m) {
            const a = arcsOn && findArc(m[2]);
            if (!a) continue;
            const desc = m[3].trim();
            if (m[1].toUpperCase() === 'REGRESS') {
                a.stage = Math.max(1, a.stage - 1);
                a.sinceShift = 0;
                if (desc) a.current = desc;
                res.regress++;
            } else if (a.sinceShift >= need) {
                a.stage++;
                a.sinceShift = 0;
                if (desc) a.current = desc;
                if (a.stage >= ARC_MAX) {
                    st.evolved.push({ who: a.who, text: `${a.text}${a.current ? ` — ${a.current}` : ''}`, at: len });
                    st.arcs = st.arcs.filter(x => x !== a);
                    res.evolved++;
                } else {
                    res.shifts++;
                }
            } else if (desc) {
                // Если для полного сдвига ещё мало стимулов, сохраняем наблюдение модели как стимул
                a.stimuli.push({ text: desc, at: len });
                if (a.stimuli.length > 6) a.stimuli.shift();
                a.sinceShift++;
                res.stimuli++;
            }
            continue;
        }

        m = line.match(/^DROP\s*#?\s*A\s*(\d+)/i);
        if (m) {
            st.arcs = st.arcs.filter(a => a.id !== Number(m[1]));
            continue;
        }

        m = line.match(/^NPC(?!STATE)(?=[\s\[:：])\s*[:：]?\s*\[?([^\]:：—–\n]{1,60}?)\]?\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/i);
        if (m) {
            if (npcsOn) {
                const name = m[1].trim();
                const n = findNpc(st, name);
                if (!n) {
                    if (st.npcs.length < (Number(s.maxNpcs) || 20)) {
                        st.npcs.push({ id: st.nextNpcId++, name, card: m[2].trim(), status: '', locked: false, at: len });
                        res.npcNew++;
                    }
                } else if (!n.locked) {
                    n.card = m[2].trim();
                    res.npcUpd++;
                }
            }
            continue;
        }

        m = line.match(/^NPCSTATE(?=[\s\[:：])\s*[:：]?\s*\[?([^\]:：—–\n]{1,60}?)\]?\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/i);
        if (m) {
            const n = npcsOn && findNpc(st, m[1]);
            if (n) {
                n.status = m[2].trim();
                res.npcUpd++;
            }
            continue;
        }

        m = line.match(/^REL(?=[\s\[:：])\s*[:：]?\s*\[?([^\[:：—–\n]+?)\s*(↔|<->|->|→|—|–|\+)\s*([^\]:：—–\n]+?)\]?\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            if (npcsOn) {
                const a = m[1].trim();
                const arrow = (m[2] === '->' || m[2] === '→') ? '→' : '↔';
                const b = m[3].trim();
                const rest = m[4].trim().replace(/\]$/, '');
                let type = '', desc = rest;
                if (rest.includes('|')) {
                    const parts = rest.split('|');
                    type = parts[0].trim();
                    desc = parts.slice(1).join('|').trim();
                } else {
                    const tm = rest.match(/^\[([^\]]{1,30})\]\s*(.+)$/);
                    if (tm) { type = tm[1].trim(); desc = tm[2].trim(); }
                }
                if (!st.relationships) st.relationships = [];
                let rel = findRel(st, a, b);
                if (rel) {
                    if (!rel.locked) {
                        if (type) rel.type = type;
                        rel.desc = desc;
                        rel.arrow = arrow;
                        res.relUpd++;
                    }
                } else if (st.relationships.length < 30) {
                    st.relationships.push({ id: st.nextRelId++, a, b, arrow, type: type || 'связь', desc, locked: false, at: len });
                    res.relNew++;
                }
            }
            continue;
        }

        m = line.match(/^DROP\s*#?\s*R\s*(\d+)/i);
        if (m) {
            if (st.relationships) {
                const id = Number(m[1]);
                st.relationships = st.relationships.filter(r => r.id !== id);
            }
            continue;
        }

        m = line.match(/^INTRIGUE\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            if (intriguesOn) {
                const it = { id: st.nextIntrigueId++, tag: (m[1] || '').trim(), text: m[2].trim(), clues: [], at: len };
                st.intrigues.push(it);
                res.intrigues.push(it);
            }
            continue;
        }

        m = line.match(/^CLUE\s*#?\s*T?\s*(\d+)\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const it = st.intrigues.find(x => x.id === Number(m[1]));
            if (it) {
                it.clues.push({ text: m[2].trim(), at: len });
                if (it.clues.length > 8) it.clues.shift();
                res.clues++;
            }
            continue;
        }

        m = line.match(/^(SOLVED|DROP)\s*:?\s*#?\s*T\s*(\d+)/i);
        if (m) {
            const i = st.intrigues.findIndex(x => x.id === Number(m[2]));
            if (i >= 0) {
                const [it] = st.intrigues.splice(i, 1);
                it.kind = 'intrigue';
                it.status = m[1].toUpperCase() === 'SOLVED' ? 'done' : 'dropped';
                it.closedAt = len;
                st.archive.push(it);
                if (it.status === 'done') res.solved++;
            }
            continue;
        }

        m = line.match(/^(DONE|DROP)\s*:?\s*#?\s*(\d+)/i);
        if (m) {
            const id = Number(m[2]);
            const i = st.notes.findIndex(n => n.id === id);
            if (i >= 0) {
                const [n] = st.notes.splice(i, 1);
                n.status = m[1].toUpperCase() === 'DONE' ? 'done' : 'dropped';
                n.closedAt = len;
                st.archive.push(n);
                (n.status === 'done' ? res.done : res.dropped).push(n);
            }
        }
    }

    const max = Math.max(1, Number(s.maxActive) || 12);
    while (st.notes.length > max) {
        const n = st.notes.shift();
        n.status = 'dropped';
        n.closedAt = len;
        st.archive.push(n);
    }
    const maxI = Math.max(1, Number(s.maxIntrigues) || 5);
    while (st.intrigues.length > maxI) {
        const it = st.intrigues.shift();
        Object.assign(it, { kind: 'intrigue', status: 'dropped', closedAt: len });
        st.archive.push(it);
    }
    if (st.archive.length > 50) st.archive.splice(0, st.archive.length - 50);
    return res;
}

function report(res, manual, raw) {
    const s = settings();
    const clean = String(raw || '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
    if (!clean) {
        toastr.warning('Модель вернула пустой ответ. Обычно это значит, что «думающей» модели не хватило лимита длины ответа, или ответ заблокировал фильтр провайдера.', 'Блокнот рассказчика', { timeOut: 10000 });
        return;
    }
    const parts = [];
    if (res.added.length) parts.push(`новых записей: ${res.added.length}`);
    if (res.done.length) parts.push(`выполнено: ${res.done.length}`);
    if (res.dropped.length) parts.push(`вычеркнуто: ${res.dropped.length}`);
    if (res.intrigues.length) parts.push(`новых тайн: ${res.intrigues.length}`);
    if (res.clues) parts.push(`открылось улик: ${res.clues}`);
    if (res.solved) parts.push(`раскрыто тайн: ${res.solved}`);
    if (res.npcNew) parts.push(`новых NPC: ${res.npcNew}`);
    if (res.npcUpd) parts.push(`обновлено NPC: ${res.npcUpd}`);
    if (res.relNew) parts.push(`новых связей: ${res.relNew}`);
    if (res.relUpd) parts.push(`обновлено связей: ${res.relUpd}`);
    if (res.arcNew) parts.push(`новых арок: ${res.arcNew}`);
    if (res.stimuli) parts.push(`стимулов: ${res.stimuli}`);
    if (res.shifts) parts.push(`🌱 сдвигов характера: ${res.shifts}`);
    if (res.evolved) parts.push(`🌳 закреплено изменений: ${res.evolved}`);
    if (res.regress) parts.push(`откатов: ${res.regress}`);
    if (res.timeMoved) parts.push(`📅 ${res.timeMoved > 0 ? 'прошло' : 'назад на'} ${daysWord(Math.abs(res.timeMoved))} → ${formatDate(store().time.date)}`);
    else if (res.dateSet) parts.push(`📅 дата истории: ${formatDate(res.dateSet)}`);
    if (res.placeSet) parts.push(`📍 место: ${placeLine(store())}`);
    if (res.events) parts.push(`📜 в хронику: ${res.events.length}`);
    if (res.bdays) parts.push(`🎂 дни рождения: ${res.bdays.join(', ')}`);
    if (res.outfit && store().direction.wardrobe) parts.push('👗 пора выбрать наряд');
    if (res.items) parts.push(`🎁 в шкатулку: ${res.items.join(', ')}`);
    if (res.places) parts.push(`🗺 на карте: ${res.places.join(', ')}`);
    if (res.outfitDone && store().direction.wardrobe) parts.push('🎭 образ отыгран');
    holidaySummary(res).forEach(x => parts.push(escapeHtml(x)));
    if (!parts.length) {
        if (/^NONE[.!]?$/i.test(clean.replace(/\*\*/g, ''))) {
            if (manual) toastr.info('Модель решила ничего не записывать', 'Блокнот рассказчика');
        } else {
            toastr.warning('Модель ответила не по формату — загляни в «Последний ответ модели»', 'Блокнот рассказчика', { timeOut: 8000 });
        }
        return;
    }
    if (!s.showToasts && !manual) return;
    let body = parts.join(', ');
    if (!s.hideSpoilers && res.added.length) {
        body += '<br>' + res.added.map(n => `• ${escapeHtml(n.text)}`).join('<br>');
    }
    if (!s.hideSpoilers && res.intrigues.length) {
        body += '<br>' + res.intrigues.map(n => `🔒 ${escapeHtml(n.text)}`).join('<br>');
    }
    toastr.success(body, 'Блокнот рассказчика', { escapeHtml: false, timeOut: 8000 });
}

function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}


async function generateActionPromptsNow() {
    const c = ctx();
    const chat = c.chat;
    if (!chat || !chat.length) return toastr.warning('Чат пуст', '💡 Подсказки');
    const lastIdx = chat.length - 1;
    const lastMsg = chat[lastIdx];
    if (!lastMsg || lastMsg.is_user) return toastr.info('Подсказки действий создаются для последнего ответа персонажа', '💡 Подсказки');

    if (Array.isArray(lastMsg.extra?.actions) && lastMsg.extra.actions.length) {
        renderActionPrompts();
        return;
    }

    const user = storyNames().user;
    const st = store();
    const poiLine = (st && livingWorldOn(st))
        ? `\n— Если в сцене есть точки интереса, необычные детали окружения, фоновые персонажи или зацепки локации, хотя бы один вариант должен предлагать ${user} изучить, осмотреть или задействовать этот крючок мира.`
        : '';
    const prompt = `[OOC: Пауза в ролевой игре. Ты — автор этой истории. Предложи три возможных варианта следующего хода для игрока (${user}) — что может сделать или сказать САМА ${user} в ответ на последнее сообщение:
<!--ACTIONS: вариант 1 | вариант 2 | вариант 3-->
Требования к вариантам:
— Все 3 варианта — это действия и реплики САМОЙ ${user} (что сделает или скажет ${user}), а НЕ других персонажей по отношению к ней! Никаких «протянуть ${user}», «спросить у ${user}», «посмотреть на ${user}» — действует только сама ${user}.
— Три варианта должны существенно отличаться друг от друга по смыслу и тону (не быть перефразировкой одной мысли).
— Каждый вариант ведёт сцену в другое русло: сочетай разные формы (прямая речь от ${user}, физическое действие или жест, пауза/молчание, смена темы, неожиданная реакция).${poiLine}
— Формулируй кратко (1–2 фразы), чтобы ${user} могла выбрать вариант как свой следующий ход.
Ответь ТОЛЬКО строкой в формате <!--ACTIONS: вариант 1 | вариант 2 | вариант 3-->]`;

    toastr.info('Придумываю варианты действий…', '💡 Подсказки');
    try {
        const raw = await quietGenerate(prompt);
        const m = raw && raw.match(/(?:<!--\s*ACTIONS|\[\s*ACTIONS|\bACTIONS)\s*[:：]\s*([\s\S]+?)(?:-->|\]|$)/i);
        if (m) {
            const parsed = parseActionPrompts(m[1]);
            if (parsed.length) {
                lastMsg.extra = lastMsg.extra || {};
                lastMsg.extra.actions = parsed;
                await c.saveChat();
                renderActionPrompts();
                toastr.success('Варианты действий готовы!', '💡 Подсказки');
                return;
            }
        }
        toastr.warning('Модель ответила не по формату, попробуй ещё раз', '💡 Подсказки');
    } catch (e) {
        console.error('[npc_notebook] actions generation error:', e);
        toastr.error('Не удалось сгенерировать варианты', '💡 Подсказки');
    }
}

async function think(manual = false) {
    if (busy) return;
    const s = settings();
    const st = store();
    if (!st) {
        if (manual) toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
        return;
    }
    if (!ctx().chat?.length) return;

    const chatIdAtStart = ctx().chatId;
    busy = true;
    let afterBusy = null;
    setStatus('Модель листает блокнот…');
    // убираем инъекцию на время размышления, чтобы блокнот не дублировался
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    ctx().setExtensionPrompt(ACTION_INJECT_KEY, '', POS_IN_CHAT, 0);

    try {
        const tpl = ensureSections(s.thinkPrompt);
        const raw = await quietGenerate(fillTemplate(tpl, st.notes, buildDirection(st), buildIntrigueSection(st), buildNpcSection(st), buildArcSection(st), buildTimeSectionFull(st), [buildWardrobeSection(st), buildMapSection(st)].filter(Boolean).join('\n')));
        if (ctx().chatId !== chatIdAtStart) return; // чат сменили, пока модель думала
        st.lastRaw = String(raw ?? '');
        const res = parseAndApply(raw);
        report(res, manual, raw);
        if (st.direction.time) {
            await fillFlavor(st, false);
            await holidayStep(st);
        }
        if (st.direction.wardrobe) {
            const w = st.wardrobe;
            if (res.outfitDone && w.active?.status === 'worn') {
                setStatus('🎭 Модель подводит итог образа…');
                if (await revealOutfit(st)) afterBusy = showRevealPopup;
            } else if (res.outfit && !w.active) {
                setStatus('👗 Модель подбирает образы…');
                if (await generateOutfits(st, res.outfit)) afterBusy = presentLooks;
            }
        }
    } catch (err) {
        console.error('[npc_notebook]', err);
        toastr.error(String(err?.message || err), 'Блокнот рассказчика: ошибка');
    } finally {
        if (ctx().chatId === chatIdAtStart) {
            st.lastThinkAt = ctx().chat.length;
            await ctx().saveMetadata();
        }
        busy = false;
        updateInjection();
        renderPanel();
        if (afterBusy && ctx().chatId === chatIdAtStart) afterBusy();
    }
}

function storyNames() {
    const c = ctx();
    let chars = [];
    try {
        if (c.groupId && Array.isArray(c.groups)) {
            const g = c.groups.find(x => x.id === c.groupId);
            chars = (g?.members || []).map(av => c.characters.find(ch => ch.avatar === av)?.name).filter(Boolean);
        }
    } catch (e) { /* ignore */ }
    if (!chars.length && c.name2) chars = [c.name2];
    return { user: c.name1 || 'игрок', char: chars.join(', ') || 'персонаж', chars };
}

function buildTimeSectionFull(st) {
    if (!st?.direction?.time) return '';
    const names = storyNames();
    return [buildTimeSection(st), bdaySection(st, names.user, names.chars, st.direction.npcs ? st.npcs.map(n => n.name) : []), settings().events ? holidayCheckSection(st) : ''].filter(Boolean).join('\n\n');
}

// Если в своём промпте нет нужных разделов, вставляем их перед финальной инструкцией
function ensureSections(tpl) {
    const missing = ['direction', 'time', 'npcs', 'arcs', 'intrigues', 'wardrobe'].filter(k => !tpl.includes(`{{${k}}}`));
    if (!missing.length) return tpl;
    const block = missing.map(k => `{{${k}}}`).join('\n\n') + '\n\n';
    let at = tpl.lastIndexOf('Ответь ТОЛЬКО');
    if (at < 0) at = tpl.lastIndexOf('NONE');
    if (at < 0) return tpl + '\n\n' + block;
    const lineStart = tpl.lastIndexOf('\n', at) + 1;
    return tpl.slice(0, lineStart) + block + tpl.slice(lineStart);
}

async function rerollNote(id, kind = 'note') {
    if (busy) return;
    const st = store();
    const isIntrigue = kind === 'intrigue';
    const note = (isIntrigue ? st?.intrigues : st?.notes)?.find(n => n.id === id);
    if (!note) return;
    const chatIdAtStart = ctx().chatId;
    busy = true;
    setStatus('Модель переписывает задумку…');
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    try {
        const others = isIntrigue ? st.notes : st.notes.filter(n => n.id !== id);
        const tpl = (isIntrigue ? REROLL_INTRIGUE_PROMPT : REROLL_PROMPT).replace('{{old}}', note.text);
        const prompt = fillTemplate(tpl, others, buildDirection(st));
        const raw = String(await quietGenerate(prompt) ?? '');
        if (ctx().chatId !== chatIdAtStart) return;
        st.lastRaw = raw;
        const clean = raw.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/\*\*/g, '');
        let m = null;
        for (let line of clean.split('\n')) {
            line = bracketTag(line.trim().replace(/^[-*•>\s]+/, ''));
            m = line.match(isIntrigue
                ? /^INTRIGUE\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i
                : /^ADD\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i);
            if (m) break;
        }
        if (!m) {
            toastr.warning('Модель ответила не по формату — загляни в «Последний ответ модели»', 'Блокнот рассказчика');
            return;
        }
        st.rejected.push(note.text);
        if (st.rejected.length > 15) st.rejected.splice(0, st.rejected.length - 15);
        note.text = m[2].trim().replace(/\]$/, '');
        if (m[1]) note.tag = m[1].trim();
        note.at = ctx().chat.length;
        if (isIntrigue) note.clues = [];
        if (!settings().hideSpoilers) toastr.success(escapeHtml(note.text), 'Новая задумка', { escapeHtml: false, timeOut: 8000 });
        else toastr.success('Задумка заменена', 'Блокнот рассказчика');
    } catch (err) {
        console.error('[npc_notebook]', err);
        toastr.error(String(err?.message || err), 'Блокнот рассказчика: ошибка');
    } finally {
        if (ctx().chatId === chatIdAtStart) await ctx().saveMetadata();
        busy = false;
        updateInjection();
        renderPanel();
    }
}

// Колорит — отдельным запросом (модель не пропустит его, как строку среди многих команд)
async function fillFlavor(st, manual) {
    const t = st.time;
    if (!placeLine(st) || (!manual && (t.flavor || t.flavorLocked))) return false;
    try {
        const text = cleanFlavor(await quietGenerate(flavorPrompt(st)));
        if (!text) { if (manual) toastr.warning('Модель не написала колорит — попробуй ещё раз', 'Блокнот рассказчика'); return false; }
        // модель иногда вместо справки продолжает сцену — такое не записываем
        const names = storyNames();
        const heroes = [names.user, ...names.chars, ...st.npcs.map(n => n.name)].filter(n => n && n.length > 2).map(n => n.toLowerCase().replace(/ё/g, 'е'));
        const low = text.toLowerCase().replace(/ё/g, 'е');
        if (heroes.some(n => low.includes(n)) || text.length > 1200) {
            st.lastRaw = text;
            toastr.warning('Вместо колорита модель продолжила сцену — не записала. Нажми «Сгенерировать колорит» ещё раз.', 'Блокнот рассказчика', { timeOut: 9000 });
            return false;
        }
        t.flavor = text;
        t.flavorLocked = false;
        if (manual) toastr.success('🧭 Колорит обновлён', 'Блокнот рассказчика');
        return true;
    } catch (err) {
        if (manual) toastr.error(String(err?.message || err), 'Блокнот рассказчика: ошибка');
        return false;
    }
}

// Напоминания, итог закончившегося праздника, запуск нового. Вызывать внутри busy.
async function holidayStep(st, opts) {
    const s = settings();
    await holidayProgress(st, {
        generate: p => quietGenerate(p),
        toast: x => toastr.info(escapeHtml(x).replace(/\n/g, '<br>'), 'Блокнот рассказчика', { escapeHtml: false, timeOut: 9000 }),
        names: storyNames(),
        direction: buildDirection(st),
        lead: Math.max(1, Number(s.leadDays) || 3),
        events: !!s.events,
        showToasts: !!s.showToasts,
    }, opts);
}

async function runHolidayStep(opts) {
    if (busy) return;
    const st = store();
    if (!st || !st.direction.time) return;
    const chatId = ctx().chatId;
    busy = true;
    setStatus('Проверяю праздники…');
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    try {
        await holidayStep(st, opts);
    } catch (err) {
        console.error('[npc_notebook]', err);
    } finally {
        if (ctx().chatId === chatId) await ctx().saveMetadata();
        busy = false;
        updateInjection();
        renderPanel();
    }
}

async function runFlavor() {
    if (busy) return;
    const st = store();
    if (!st) return;
    busy = true;
    setStatus('Модель пишет местный колорит…');
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    try {
        await fillFlavor(st, true);
        await ctx().saveMetadata();
    } finally {
        busy = false;
        updateInjection();
        renderPanel();
    }
}

// Общая обёртка для ручных действий с запросом к модели
async function withBusy(status, fn) {
    if (busy) {
        toastr.info('Модель уже занята — подожди пару секунд', 'Блокнот рассказчика');
        return undefined;
    }
    const st = store();
    if (!st) {
        toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
        return undefined;
    }
    const chatId = ctx().chatId;
    busy = true;
    setStatus(status);
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    try {
        return await fn(st);
    } catch (err) {
        console.error('[npc_notebook]', err);
        toastr.error(String(err?.message || err), 'Блокнот рассказчика: ошибка');
        return undefined;
    } finally {
        if (ctx().chatId === chatId) await ctx().saveMetadata();
        busy = false;
        updateInjection();
        renderPanel();
    }
}

function cleanAnswer(raw) {
    return normalizeSpaces(raw).replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/\*\*/g, '');
}

function answerLines(raw) {
    return cleanAnswer(raw).split('\n').map(l => l.trim().replace(/^[-*•>\s]+/, '').replace(/^`+|`+$/g, '').trim()).filter(Boolean);
}

// ---------- Перемотка ⏩ ----------

function fastForwardPrompt(st) {
    const parts = ['[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — автор этой истории. Игрок нажал «перемотку»: текущая сцена исчерпала себя, пора перейти к следующему событию. Перечитай чат и выбери самое органичное продолжение — то, что естественно вытекает из происходящего и давно просится в историю.'];
    const dir = buildDirection(st);
    if (dir) parts.push(dir);
    parts.push('Задумки в блокноте:\n' + formatNotes(st.notes));
    if (st.direction.intrigues && st.intrigues.length) parts.push('Тайны (можно дать новую улику или повод):\n' + formatIntrigues(st.intrigues));
    if (st.direction.time && st.time.date) {
        const up = upcoming(st, 30).map(h => `${h.name} — ${h.ongoing ? 'идёт сейчас' : h.inDays === 0 ? 'сегодня' : `через ${daysWord(h.inDays)}`}`);
        parts.push(`Сейчас в истории: ${weekday(st.time.date)}, ${formatDate(st.time.date)}.` + (up.length ? `\nБлижайшие праздники и даты: ${up.join('; ')}.` : ''));
    }
    parts.push(`Ответь ровно тремя строками, без пояснений:
NEXT: номер задумки (#3), номер тайны (T2), HOLIDAY — праздник или день рождения из календаря, или NEW — своё событие
SKIP: сколько дней пройдёт до следующей сцены (0 — в тот же день, просто позже)
SCENE: с чего начнётся следующая сцена — обстановка и событие в 1–2 предложениях, без реплик и чувств персонажей]`);
    return parts.join('\n\n');
}

function parseFastForward(raw) {
    const out = { next: '', skip: 0, scene: '' };
    for (const line of answerLines(raw)) {
        let m = line.match(/^NEXT\s*[:：—–-]\s*(.+)$/i);
        if (m) { out.next = m[1].trim(); continue; }
        m = line.match(/^SKIP\s*[:：—–-]\s*(\d+)/i);
        if (m) { out.skip = Math.min(60, Number(m[1]) || 0); continue; }
        m = line.match(/^SCENE\s*[:：—–-]\s*(.+)$/i);
        if (m) out.scene = m[1].trim().replace(/\]$/, '');
    }
    return out;
}

async function fastForward() {
    const s = settings();
    if (!s.enabled) return toastr.info('Блокнот выключен', 'Блокнот рассказчика');
    if (!ctx().chat?.length) return toastr.warning('Чат пуст — перематывать пока нечего', 'Блокнот рассказчика');
    let text = null;
    let summary = '';
    const ok = await withBusy('⏩ Модель выбирает следующее событие…', async st => {
        const raw = await quietGenerate(fastForwardPrompt(st));
        st.lastRaw = String(raw ?? '');
        const ff = parseFastForward(raw);
        const len = ctx().chat.length;
        const noteId = ff.next.match(/^#?\s*(\d+)/);
        const note = noteId && st.notes.find(n => n.id === Number(noteId[1]));
        if (note) { note.ff = true; note.ffAt = len; }
        let moved = 0;
        if (ff.skip > 0 && st.direction.time && st.time.date) {
            st.time.date = addDays(st.time.date, ff.skip);
            moved = ff.skip;
            if (s.events) await holidayStep(st);
        }
        const scene = ff.scene || 'самое органичное следующее событие: задумка из твоего блокнота, тайна, заявленная линия или приближающаяся дата';
        const when = moved ? ` Между сценами прошло ${daysWord(moved)} — сейчас ${weekday(st.time.date)}, ${formatDate(st.time.date)}.` : (ff.skip > 0 ? ` Между сценами прошло ${daysWord(ff.skip)}.` : '');
        text = `${FF_MARKER} игрок просит перейти к следующему событию. Сверни текущую сцену одной-двумя фразами, без пересказа, и сразу начни новую: ${scene}${when} Пиши как обычный ответ, не упоминай перемотку.]`;
        summary = moved ? `📅 прошло ${daysWord(moved)} → ${formatDate(st.time.date)}` : '';
        if (!s.hideSpoilers && ff.scene) summary = [ff.scene, summary].filter(Boolean).join('<br>');
        return true;
    });
    if (!ok || !text) return;
    ctx().setExtensionPrompt(INJECT_FF_KEY, text, POS_IN_CHAT, 0, false, 0);
    ffPending = true;
    toastr.info(summary ? escapeHtml(summary).replace(/&lt;br&gt;/g, '<br>') : 'Переходим к следующему событию', '⏩ Дальше', { escapeHtml: false, timeOut: 6000 });
    const send = $('#send_but');
    if (send.length) send.trigger('click');
    else if (typeof ctx().generate === 'function') ctx().generate('normal');
}

// ---------- Праздничные задачи: реролл и правка ----------

async function rerollHolidayTask(idx) {
    await withBusy('Модель придумывает другую задачу…', async st => {
        const hol = st.holiday;
        if (!hol || hol.finished || !hol.tasks[idx]) return;
        const raw = await quietGenerate(rerollTaskPrompt(hol, idx, st, storyNames(), buildDirection(st)));
        st.lastRaw = String(raw ?? '');
        if (!applyTaskReroll(hol, idx, raw)) {
            toastr.warning('Модель ответила не по формату — загляни в «Последний ответ модели»', 'Блокнот рассказчика');
            return;
        }
        const x = hol.tasks[idx];
        if (x.hidden) toastr.success('🔒 Секретная задача заменена', 'Блокнот рассказчика');
        else toastr.success(settings().hideSpoilers ? 'Задача заменена' : escapeHtml(x.text), '🎲 Новая задача', { escapeHtml: false });
    });
}

// ---------- Гардероб 👗 ----------

const ACCENT_KINDS = {
    perfume: { icon: '🌸', name: 'духи' },
    stone: { icon: '💎', name: 'камень' },
    makeup: { icon: '💄', name: 'макияж' },
    pocket: { icon: '👜', name: 'мелочь в сумочке' },
    accessory: { icon: '💍', name: 'аксессуар' },
    find: { icon: '🎴', name: 'находка' },
};
// вещь из находок: украшения и духи годятся в штрихи, остальное — просто находка
function findKind(title) {
    const w = String(title || '').toLowerCase();
    if (/дух|парфюм|аромат|perfume/.test(w)) return 'perfume';
    if (/камен|камн|талисман|амулет|кристалл/.test(w)) return 'stone';
    if (/кольц|колечк|перстен|серьг|серёж|кулон|брош|браслет|ожерел|колье|подвеск|часы|часики|заколк|гребн|шарф|платок|сумоч|клатч|ленточк|бусы|медальон|цепочк/.test(w)) return 'accessory';
    return 'find';
}
// в штрихи годится всё из шкатулки: находки — как «мелочь в сумочке»
function wearableBox(st) {
    return st.wardrobe.box;
}
function accentKind(word) {
    const w = String(word || '').toLowerCase();
    if (/дух|парфюм|аромат|perfume/.test(w)) return 'perfume';
    if (/макияж|косметик|помад|блеск для губ|тушь|румян|тени для|стрелк|makeup|lipstick/.test(w)) return 'makeup';
    if (/мелоч|в сумочк|в карман|pocket/.test(w)) return 'pocket';
    if (/камен|камн|талисман|амулет|кристалл|stone/.test(w)) return 'stone';
    return 'accessory';
}
function accentsOn(st) {
    return !!settings().accents && !!st?.direction?.wardrobe;
}
function boxList(st, all = false) {
    return (all ? st.wardrobe.box : wearableBox(st)).map(x => `${ACCENT_KINDS[x.kind]?.icon || '🎁'} ${x.title}${x.origin ? ` (${x.origin})` : ''}`).join('; ');
}

function buildWardrobeSection(st) {
    if (!st?.direction?.wardrobe) return '';
    const w = st.wardrobe;
    const parts = [];
    if (w.active?.status === 'worn') {
        const look = w.active.look;
        parts.push(`Гардероб. Наряд {{user}}: «${look.title}»${w.active.accent ? ` + ${w.active.accent.title}` : ''}${w.active.occasion ? ` (для: ${w.active.occasion})` : ''}.
OUTFITDONE — если сцена, ради которой выбирался наряд, уже прошла или {{user}} уже переоделся(-ась).`);
    } else if (!w.active) {
        const recent = w.history.slice(-3).map(h => h.occasion).filter(Boolean).join('; ');
        parts.push(`Гардероб. Если в ближайшей сцене или скоро по сюжету важен наряд {{user}} (свидание, вечеринка, праздник, ужин с родными, важная встреча, собеседование) и образ для неё ещё не выбирали — OUTFIT: повод (коротко, например «ужин у родителей на День благодарения»). Только когда наряд действительно имеет значение.${recent ? ` Недавно уже выбирали образы для: ${recent}.` : ''}`);
    }
    if (accentsOn(st)) {
        parts.push(`Шкатулка {{user}}: ${w.box.length ? boxList(st, true) : '(пока пусто)'}.
ITEM [духи|косметика|аксессуар|мелочь]: что это — откуда (подарок, покупка, находка). Только если в чате у {{user}} действительно появилась такая вещь и её ещё нет в шкатулке.`);
    }
    return parts.join('\n');
}

function auraInjection(st) {
    const au = st?.direction?.wardrobe && st.wardrobe.aura;
    if (!au) return '';
    const len = ctx().chat?.length ?? 0;
    const alive = st.time.date && au.until ? st.time.date <= au.until : len <= (au.untilMsg || 0);
    if (!alive) return '';
    return `[Талисман: ${storyNames().user} носит ${au.title}${au.desc ? ` — ${au.desc}` : ''}. Вокруг держится лёгкий флёр${au.effects ? `: ${au.effects}` : ''}. Едва уловимо, на уровне настроения и совпадений; никто не говорит о магии прямо.]`;
}

function wardrobeInjection(st) {
    if (!st?.direction?.wardrobe) return '';
    const out = [];
    const a = st.wardrobe.active;
    const user = storyNames().user;
    if (a?.status === 'choosing') {
        out.push(`[${user} сейчас выбирает, что надеть${a.occasion ? ` (${a.occasion})` : ''}. Не описывай, во что ${user} одет(а), — это решится выбором.]`);
    } else if (a?.status === 'worn') {
        const look = a.look;
        const effects = look.effects
            ? `Скрытые последствия этого выбора (игрок их не знает): ${look.effects}. Покажи их в сцене через взгляды, поведение и реплики персонажей, когда они увидят наряд — естественно, без цифр и объявлений, и не намекай, что реакции были известны заранее.`
            : 'Персонажи реагируют на него в своём характере — кому-то понравится, кому-то нет.';
        let text = `[Наряд ${user}${a.occasion ? ` (${a.occasion})` : ''}: «${look.title}» — ${String(look.desc || '').replace(/[.\s]+$/, '')}. ${effects}`;
        const ac = a.accent;
        if (ac) {
            const k = ACCENT_KINDS[ac.kind] || ACCENT_KINDS.accessory;
            text += `\nШтрих к образу (${k.name}): «${ac.title}»${ac.desc ? ` — ${String(ac.desc).replace(/[.\s]+$/, '')}` : ''}${ac.origin ? ` (${ac.origin})` : ''}.`;
            if (ac.effects) text += ` Скрытые последствия: ${ac.effects}.`;
            if (ac.kind === 'perfume') {
                const before = st.wardrobe.history.filter(h => h.accent?.title && h.accent.title.toLowerCase() === ac.title.toLowerCase()).pop();
                text += before ? ` Этот аромат уже был на ${user}${before.occasion ? ` (${before.occasion})` : ''} — кто-то может вспомнить тот вечер.` : ' Аромат замечают не сразу — когда подходят ближе.';
            }
            if (ac.kind === 'stone') text += ' Камень даёт лёгкий флёр атмосферы — едва уловимо, можно списать на совпадение.';
            if (ac.kind === 'makeup') text += ' Макияж замечают, когда смотрят в лицо, — особенно вблизи и при хорошем свете.';
            if (ac.kind === 'pocket') text += ` Эта мелочь лежит в сумочке или кармане ${user}: найди в сцене естественный момент, когда она пригодится, выпадет или окажется кстати — не в первой же реплике.`;
            if (/подар/i.test(ac.origin || '')) text += ' Если даритель рядом, он заметит, что его подарок надет.';
        }
        out.push(text + ']');
    }
    const equipped = (st.wardrobe.box || []).filter(x => (st.wardrobe.equipped || []).includes(x.id));
    if (equipped.length) {
        out.push(`[У ${user} сейчас с собой/наготове: ${equipped.map(x => `«${x.title}»${x.desc ? ` (${x.desc})` : ''}${x.origin ? ` [${x.origin}]` : ''}`).join('; ')}. Персонажи могут обратить на это внимание, а предмет можно пустить в ход.]`);
    }
    const aura = auraInjection(st);
    if (aura) out.push(aura);
    return out.join('\n');
}

const CLOSET_CATEGORIES = ['Повседневный', 'Рабочий', 'На выход', 'Домашний', 'По погоде', 'Спортивный'];

function normalizeClosetCat(rawCat) {
    const s = String(rawCat || '').toLowerCase();
    if (/рабоч|учеб|офис|делов/.test(s)) return 'Рабочий';
    if (/выход|вечер|свидан|праздн|клуб|ресторан/.test(s)) return 'На выход';
    if (/домаш|уют|пижам|дом/.test(s)) return 'Домашний';
    if (/погод|улич|верхн|пальто|куртк|плащ|зим|осен/.test(s)) return 'По погоде';
    if (/спорт|актив|тренир|прогул|поход/.test(s)) return 'Спортивный';
    return 'Повседневный';
}

function addLookToCloset(st, look, defaultCat = 'Повседневный') {
    if (!st?.wardrobe) return null;
    if (!Array.isArray(st.wardrobe.closet)) st.wardrobe.closet = [];
    if (!st.wardrobe.nextClosetId) st.wardrobe.nextClosetId = 1;
    const title = String(look?.title || '').trim();
    if (!title) return null;
    const existing = st.wardrobe.closet.find(c => c.title.toLowerCase() === title.toLowerCase());
    if (existing) {
        if (look.desc) existing.desc = look.desc;
        if (look.effects) existing.effects = look.effects;
        if (look.en) existing.en = look.en;
        if (look.category) existing.category = normalizeClosetCat(look.category);
        return existing;
    }
    const item = {
        id: st.wardrobe.nextClosetId++,
        category: normalizeClosetCat(look.category || defaultCat),
        title,
        desc: String(look.desc || '').trim(),
        en: String(look.en || '').trim(),
        effects: String(look.effects || '').trim(),
        season: st.time?.date ? season(st.time.date).name : '',
        at: ctx().chat?.length ?? 0,
    };
    st.wardrobe.closet.push(item);
    return item;
}

function wardrobePrompt(st, occasion, exclude = []) {
    const names = storyNames();
    const t = st.time;
    const when = [t.date ? `${formatDate(t.date)}, ${season(t.date).name}` : '', placeLine(st)].filter(Boolean).join('; ');
    const recent = st.wardrobe.history.slice(-3).map(h => `«${h.title}»`);
    const closetTitles = (st.wardrobe.closet || []).slice(-15).map(c => `«${c.title}»`);
    const avoid = [...new Set([...exclude.map(x => `«${x}»`), ...recent, ...closetTitles])];
    const favs = (st.npcs || []).filter(n => n.favorite).map(n => n.name);
    const images = wantImages();
    const accents = accentsOn(st);
    const lines = [
        '[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — помощник автора и подбираешь наряд, как в визуальной новелле.',
        `${names.user} собирается: ${occasion || 'в ближайшую сцену, где важен наряд (пойми по чату, куда именно)'}.`,
        when ? `Когда и где: ${when}.` : '',
        favs.length ? `Ключевые фавориты в истории: ${favs.join(', ')}.` : '',
        buildDirection(st),
        avoid.length ? `Не повторяй эти образы: ${avoid.slice(0, 18).join(', ')}.` : '',
        `Предложи 5 разных образов для ${names.user}: от спокойного и уютного до смелого и эффектного. Учитывай внешность и стиль ${names.user}, погоду, сезон, повод и то, кто там будет.`,
        'К каждому образу придумай скрытые последствия — как на него отреагируют конкретные персонажи. Игрок их не увидит, пока сцена не пройдёт. Последствия у всех образов разные: не бывает образа, который нравится всем, и образа, который не нравится никому. Реакции — в характере персонажей и в духе жанра.',
    ];
    if (accents) {
        lines.push(`Ещё предложи 4 штриха к образу — духи, макияж, аксессуар (украшение, сумочка, часы, шарф, заколка и т.п.) и мелочь в сумочке. ${wearableBox(st).length ? `Можно взять вещь из шкатулки ${names.user}: ${boxList(st)} — особенно если она к месту.` : ''}
— Духи действуют в сцене и через память: аромат замечают вблизи, он о чём-то напоминает, может связаться с этим вечером.
— Макияж — как ${names.user} выглядит лицом: смелая помада, лёгкие блёстки, стрелки, «почти без макияжа». Меняет то, как на неё смотрят в этой сцене.
— Аксессуар — деталь, за которую цепляется взгляд и разговор; подарок, надетый при дарителе, тот обязательно заметит.
— Мелочь в сумочке — то, что можно достать посреди сцены: леденцы, старый билет, блокнот, пластырь, фотография, ключ. Это крючок для сюжета: где-то она пригодится, выпадет или вызовет вопрос.
У штрихов тоже скрытые последствия, разные по смыслу.`);
    }
    if (images) {
        lines.push('Сначала одной строкой опиши внешность для художника по-английски:');
        lines.push(`APPEARANCE: внешность ${names.user} по-английски — пол, возраст, волосы, глаза, телосложение, заметные черты`);
        lines.push('Затем по три строки на образ, без пояснений:');
        lines.push('LOOK: название образа | что надето, причёска, детали — 1–2 предложения');
        lines.push('EN: этот же наряд коротко по-английски, только одежда, обувь и причёска');
    } else {
        lines.push('Формат — по две строки на образ, без пояснений:');
        lines.push('LOOK: название образа | что надето, причёска, детали — 1–2 предложения');
    }
    lines.push('EFFECT: Имя (+): как отреагирует; Имя (−): как отреагирует');
    if (accents) {
        lines.push(images ? 'Затем по три строки на штрих:' : 'Затем по две строки на штрих:');
        lines.push('ACCENT: духи|макияж|аксессуар|мелочь | название | описание в одном предложении');
        if (images) lines.push('EN: этот же предмет коротко по-английски для художника: для духов — флакон (perfume bottle); для макияжа — макияж на лице персоны крупным планом (например: close-up beauty portrait of face, natural nose and facial proportions, wearing soft warm eyeshadow and wine-tinted lips, glasses); для аксессуара — украшение или предмет; для мелочи — небольшая вещица');
        lines.push('EFFECT: последствия — кто как отреагирует; для мелочи — когда и как она всплывёт в сцене');
    }
    return lines.filter(Boolean).join('\n') + ']';
}

// ---------- картинка с образами ----------
function imageCommand() {
    const cmds = ctx().SlashCommandParser?.commands;
    if (!cmds) return '';
    return cmds.imagine ? 'imagine' : cmds.sd ? 'sd' : '';
}
function wantImages() {
    const s = settings();
    if (!s.wardrobeImages) return false;
    if (s.imageSource === 'openai-images') return !!(s.imgApiBase && s.imgApiKey && s.imgApiModel);
    if (s.imageSource) return !!ctx().ConnectionManagerRequestService?.sendRequest;
    return !!imageCommand();
}
function connectionProfiles() {
    return ctx().extensionSettings?.connectionManager?.profiles || [];
}

// Ищем картинку в ответе модели: data-URL или ссылка на картинку
function extractImage(raw) {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
    let m = text.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i);
    if (m) return m[0];
    m = text.match(/https?:\/\/[^\s"'()<>\]\\]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'()<>\]\\]*)?/i);
    return m ? m[0] : '';
}

// Сохраняем картинку на сервер Таверны, чтобы не раздувать файл чата
async function storeImage(url) {
    if (!url.startsWith('data:')) return url;
    try {
        const [, format, data] = url.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i) || [];
        if (!data) return url;
        const res = await fetch('/api/images/upload', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ image: data, format: format.replace('jpeg', 'jpg'), ch_name: 'Гардероб', filename: `wardrobe_${Date.now()}` }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        return json.path || url;
    } catch (e) {
        console.warn('[npc_notebook] upload', e);
        return url;
    }
}

// Аватар персоны как образец лица
async function fileToDataUrl(file) {
    if (!file) return '';
    if (file.startsWith('data:')) return file;
    try {
        const res = await fetch(file.startsWith('/') || file.startsWith('http') ? file : '/' + file.split('/').map(encodeURIComponent).join('/'));
        if (!res.ok) return '';
        const blob = await res.blob();
        if (!blob.type.startsWith('image/') || blob.size > 8 * 1024 * 1024) return '';
        return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result || '')); fr.onerror = () => r(''); fr.readAsDataURL(blob); });
    } catch (e) {
        return '';
    }
}
// Аватары персонажей чата: [{ name, file }]
function characterAvatars() {
    const c = ctx();
    let list = [];
    try {
        if (c.groupId && Array.isArray(c.groups)) {
            const g = c.groups.find(x => x.id === c.groupId);
            list = (g?.members || []).map(av => c.characters.find(ch => ch.avatar === av)).filter(Boolean);
        } else if (c.characterId !== undefined && c.characters?.[c.characterId]) {
            list = [c.characters[c.characterId]];
        }
    } catch (e) { list = []; }
    return list.filter(ch => ch.avatar && ch.avatar !== 'none').map(ch => ({ name: ch.name, file: `characters/${ch.avatar}` }));
}

async function personaAvatarDataUrl() {
    try {
        const chat = ctx().chat || [];
        let file = '';
        for (let i = chat.length - 1; i >= 0 && !file; i--) if (chat[i]?.is_user && chat[i].force_avatar) file = chat[i].force_avatar;
        if (!file) {
            const id = $('#user_avatar_block .avatar-container.selected').attr('data-avatar-id') || $('#user_avatar_block .selected').attr('imgfile');
            if (id) file = `User Avatars/${id}`;
        }
        if (!file) return '';
        const res = await fetch(file.startsWith('/') || file.startsWith('http') ? file : '/' + file.split('/').map(encodeURIComponent).join('/'));
        if (!res.ok) return '';
        const blob = await res.blob();
        if (!blob.type.startsWith('image/') || blob.size > 4 * 1024 * 1024) return '';
        return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result || '')); fr.onerror = () => r(''); fr.readAsDataURL(blob); });
    } catch (e) {
        return '';
    }
}

function withTimeout(promise, ms, what) {
    let t;
    return Promise.race([
        promise,
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: нет ответа ${Math.round(ms / 1000)} сек.`)), ms); }),
    ]).finally(() => clearTimeout(t));
}
function imageSourceName() {
    const id = settings().imageSource;
    if (!id) return 'генерацию картинок Таверны';
    if (id === 'openai-images') return `картинки OpenAI (${settings().imgApiModel})`;
    const p = connectionProfiles().find(x => x.id === id);
    return p ? `профиль «${p.name}»` : 'удалённый профиль';
}

function detectRefusalOrError(raw) {
    if (!raw) return '';
    const t = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (/safety|content policy|policy violation|violat|censor|inappropriate|nsfw|cannot (fulfill|generate|create)|I am unable to|refuse|sorry|filter/i.test(t)) {
        return t.slice(0, 300);
    }
    if (typeof raw === 'string' && raw.length < 500 && !raw.includes('data:image') && !raw.includes('http')) {
        return raw.trim();
    }
    return '';
}

// refs: { images: [dataUrl…], note: 'что делать с образцами' } или null
async function drawViaProfile(basePrompt, refs, profileId) {
    const svc = ctx().ConnectionManagerRequestService;
    if (!svc?.sendRequest) throw new Error('в этой версии Таверны нет менеджера подключений');
    const prompt = basePrompt + '. Generate this image.';
    const opts = { stream: false, extractData: false, includePreset: false };
    console.log('[npc_notebook] drawViaProfile: start profileId=' + profileId + ', prompt len=' + prompt.length + ', refs=' + (refs?.images?.length || 0));
    let raw = null;
    let refusal = '';
    if (refs?.images?.length) {
        try {
            raw = await withTimeout(svc.sendRequest(profileId, [{ role: 'user', content: [
                { type: 'text', text: prompt + ' ' + refs.note },
                ...refs.images.map(url => ({ type: 'image_url', image_url: { url } })),
            ] }], 8192, opts), 75000, 'рисунок с образцом');
            if (!extractImage(raw)) {
                refusal = detectRefusalOrError(raw);
                console.warn('[npc_notebook] Ref response has no image:', raw);
                raw = null;
            }
        } catch (e) {
            console.warn('[npc_notebook] image with reference failed, retrying without', e);
            refusal = e?.message || '';
            raw = null;
        }
        if (!raw) {
            toastr.info('С образцом лица не вышло — пробую нарисовать без него…', '🎨 Картинка', { timeOut: 4000 });
        }
    }
    if (!raw) {
        console.log('[npc_notebook] drawViaProfile: requesting without reference...');
        raw = await withTimeout(svc.sendRequest(profileId, [{ role: 'user', content: prompt }], 8192, opts), 75000, 'рисунок');
    }
    const url = extractImage(raw);
    if (!url) {
        const refText = detectRefusalOrError(raw) || refusal;
        console.warn('[npc_notebook] Model response has no image:', raw);
        if (refText) throw new Error(`Отказ генератора (фильтр/цензура): «${refText}»`);
        throw new Error('модель ответила без картинки (проверь логи консоли F12)');
    }
    console.log('[npc_notebook] Image extracted successfully');
    return storeImage(url);
}
// ---------- картинки через OpenAI-совместимый адрес /images (gpt-image) ----------
// Браузер может не пустить запрос к чужому сайту (CORS) — тогда пробуем через прокси Таверны.
async function imagesFetch(url, init) {
    try {
        return await fetch(url, init);
    } catch (e) {
        const viaProxy = '/proxy/' + url;
        const res = await fetch(viaProxy, init).catch(() => null);
        if (!res || res.status === 404) throw new Error('браузер не пустил запрос к сайту картинок. Включи прокси Таверны: в config.yaml поставь enableCorsProxy: true и перезапусти Таверну');
        return res;
    }
}
function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
}
async function imagesResult(res) {
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* не JSON */ }
    if (!res.ok) throw new Error(`сайт картинок ответил ${res.status}: ${String(json?.error?.message || text).slice(0, 200)}`);
    const d = json?.data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d?.url) return d.url;
    const any = extractImage(json ?? text);
    if (any) return any;
    throw new Error('сайт картинок ответил без картинки');
}
async function drawViaImagesApi(prompt, refs, size) {
    const s = settings();
    const base = String(s.imgApiBase || '').replace(/\/+$/, '');
    const auth = { Authorization: `Bearer ${s.imgApiKey}` };
    console.log('[npc_notebook] drawViaImagesApi: start model=' + s.imgApiModel + ', base=' + base);
    if (refs?.images?.length) {
        try {
            const fd = new FormData();
            fd.append('model', s.imgApiModel);
            fd.append('prompt', prompt + '. ' + refs.note);
            if (refs.images.length === 1) fd.append('image', dataUrlToBlob(refs.images[0]), 'reference.png');
            else refs.images.forEach((r, i) => fd.append('image[]', dataUrlToBlob(r), `reference${i + 1}.png`));
            fd.append('n', '1');
            if (size) fd.append('size', size);
            const res = await withTimeout(imagesFetch(`${base}/images/edits`, { method: 'POST', headers: auth, body: fd }), 75000, 'рисунок с образцом');
            return storeImage(await imagesResult(res));
        } catch (e) {
            console.warn('[npc_notebook] images/edits failed, retrying without reference', e);
            toastr.info('С образцом лица не вышло — пробую нарисовать без него…', '🎨 Картинка', { timeOut: 4000 });
        }
    }
    const body = { model: s.imgApiModel, prompt, n: 1 };
    if (size) body.size = size;
    const res = await withTimeout(imagesFetch(`${base}/images/generations`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 75000, 'рисунок');
    return storeImage(await imagesResult(res));
}

function cleanForCommand(t) {
    return String(t || '').replace(/[|{}\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function imgOrient() {
    return settings().imgOrientation === 'landscape' ? 'landscape' : 'portrait';
}
function looksLayout(n) {
    return imgOrient() === 'portrait' && n > 2 ? { rows: 2, cols: 2 } : { rows: 1, cols: n };
}
function sheetPrompt(a, layout) {
    const looks = a.options.slice(0, 4);
    const who = a.appearance || 'young woman';
    const common = 'full body, standing, plain light background, the same face, hair and body in every figure, not overlapping';
    if (layout?.rows === 2) {
        const pos = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
        return cleanForCommand(`character outfit sheet arranged as a 2 by 2 grid of equal cells, the same ${who} shown ${looks.length} times, each figure centered in its own cell, ${common}, ` +
            looks.map((o, i) => `${pos[i]} cell wearing ${o.en || o.title}`).join('; ') + ', no text, no captions');
    }
    const pos = ['first', 'second', 'third', 'fourth'];
    return cleanForCommand(`character outfit sheet, the same ${who} shown ${looks.length} times side by side, each figure centered in its own equal part of the image, ${common}, ` +
        looks.map((o, i) => `${pos[i]} from the left wearing ${o.en || o.title}`).join('; ') + ', no text, no captions');
}

// Состояние рисования: отдельно для образов и для штрихов
const drawingKind = { looks: false, accents: false, gacha: false };
const drawWaitersOf = { looks: new Set(), accents: new Set(), gacha: new Set() };
const PIC_FIELDS = { looks: ['image', 'imageFailed'], accents: ['accentImage', 'accentImageFailed'], gacha: ['image', 'imageFailed'] };
const activeOf = (kind, st = store()) => (kind === 'gacha' ? st?.gacha?.active : st?.wardrobe?.active);

// orient: 'portrait' | 'landscape' — размер для сайта картинок и подсказка в тексте для остальных
async function drawPicture(prompt, refs, orient = 'landscape') {
    const src = settings().imageSource;
    const size = orient === 'portrait' ? '1024x1536' : '1536x1024';
    if (src === 'openai-images') return drawViaImagesApi(prompt, refs, size);
    prompt = `${prompt}, ${orient === 'portrait' ? 'vertical portrait image, 2:3' : 'wide landscape image, 3:2'}`;
    if (src) return drawViaProfile(prompt, refs, src);
    const c = ctx();
    const cmd = imageCommand();
    if (!cmd) throw new Error('генерация картинок не подключена');
    const run = c.executeSlashCommandsWithOptions || c.executeSlashCommands;
    if (typeof run !== 'function') throw new Error('эта версия Таверны не умеет запускать команды из расширений');
    console.log('[npc_notebook] executing slash command: /' + cmd);
    const r = await withTimeout(Promise.resolve(run(`/${cmd} quiet=true ${prompt}`)), 75000, 'генерация картинок');
    const url = String(typeof r === 'string' ? r : (r?.pipe ?? '')).trim();
    if (!url || /\s/.test(url)) {
        if (url && (url.toLowerCase().includes('error') || url.toLowerCase().includes('fail') || url.toLowerCase().includes('censor'))) {
            throw new Error(`генератор вернул ошибку: ${url}`);
        }
        throw new Error('генератор не вернул картинку');
    }
    return url;
}

// предметы рисуем в том же духе, что и образы: иллюстрация, а не фото
const ITEM_STYLE = 'semi-realistic anime illustration, soft painterly digital art, clean outlines, warm gentle colors, visual novel item art, not a photo';

function accentsLayout(n) {
    return n >= 4 ? { rows: 2, cols: 2 } : { rows: 1, cols: n };
}

function cleanMakeupEn(en, x, who) {
    const raw = String(en || '').trim();
    const person = who || 'beautiful young woman';
    let details = raw;
    if (!details || details.length < 5) {
        details = x?.desc || 'subtle elegant makeup';
    }
    return `close-up beauty portrait of ${person}, complete face with natural proportions, well-defined nose, eyes and lips, wearing ${details}, soft studio lighting, looking towards camera`;
}

function accentEnDesc(x, who) {
    let en = String(x.en || x.title || '').trim();
    if (x.kind === 'makeup' || /макияж|makeup|lipstick|тени|помад/i.test(x.kind || x.title)) {
        return cleanMakeupEn(en, x, who);
    }
    return en;
}

function accentsPrompt(a, layout) {
    const items = (a.accents || []).slice(0, 4);
    const L = layout || accentsLayout(items.length);
    const who = a.appearance || 'young woman';
    if (L.rows === 2) {
        const pos = ['top-left cell', 'top-right cell', 'bottom-left cell', 'bottom-right cell'];
        return cleanForCommand(`${ITEM_STYLE}, sheet arranged as a 2 by 2 grid of 4 equal cells, each cell with its own isolated item or portrait, solid plain light cream background, ` +
            items.map((x, i) => `${pos[i]}: ${accentEnDesc(x, who)}`).join('; ') + ', no text, no captions');
    }
    const pos = ['first', 'second', 'third', 'fourth'];
    return cleanForCommand(`${ITEM_STYLE}, ${items.length} separate elements in a row, wide spacing, each element small and centered with wide empty space around it, solid plain light cream background, ` +
        items.map((x, i) => `${pos[i]} from the left: ${accentEnDesc(x, who)}`).join('; ') + ', no text, no captions');
}


// Рисует картинку для текущего выбора (kind: looks | accents); onDone получает адрес картинки или ''
async function ensurePicture(kind, force, onDone) {
    const st = store();
    const a = activeOf(kind, st);
    const [field, failField] = PIC_FIELDS[kind];
    const okState = kind === 'looks' || kind === 'gacha' ? a?.status === 'choosing' : (a && (a.status === 'choosing' || (a.status === 'worn' && !a.accent)) && (a.accents || []).length);
    if (!a || !okState || !wantImages()) { onDone?.(a?.[field] || ''); return; }
    if (onDone) drawWaitersOf[kind].add(onDone);
    if (drawingKind[kind]) return;
    if (a[field] && !force) { flushPicture(kind, a[field]); return; }
    drawingKind[kind] = true;
    let url = '';
    try {
        let refs = null;
        if ((kind === 'looks' || kind === 'accents') && settings().imageRef) {
            const me = await personaAvatarDataUrl();
            if (me) {
                const note = kind === 'looks'
                    ? 'The input picture is the reference: keep exactly this character — the same face, hair, eyes and body — and only change the clothes.'
                    : 'The input picture is the reference for the character face: keep the same face, hair, eyes, nose and facial features recognizable, showing her with the specified makeup in the portrait cell.';
                refs = { images: [me], note };
            }
        }
        const layout = kind === 'looks' ? looksLayout(Math.min(a.options.length, 4)) : kind === 'accents' ? accentsLayout((a.accents || []).length) : { rows: 1, cols: Math.min(a.options.length, 3) };
        const orient = (kind === 'looks' || kind === 'accents') && layout.rows === 2 ? 'portrait' : 'landscape';
        url = await drawPicture(kind === 'looks' ? sheetPrompt(a, layout) : kind === 'gacha' ? gachaPicPrompt(a) : accentsPrompt(a, layout), refs, orient);
        a[field] = url;
        a[field + 'Layout'] = layout;
        a[failField] = false;
        await ctx().saveMetadata();
    } catch (err) {
        a[failField] = true;
        console.warn('[npc_notebook] image', kind, err);
        toastr.warning(`Картинку ${kind === 'looks' ? 'с образами' : kind === 'gacha' ? 'с находками' : 'со штрихами'} нарисовать не вышло: ${escapeHtml(err?.message || err)}. Выбирать можно и по названиям.`, kind === 'gacha' ? '🎰 Находки' : '👗 Гардероб', { escapeHtml: false, timeOut: 10000 });
    } finally {
        drawingKind[kind] = false;
        flushPicture(kind, url);
    }
    // штрихи рисуем следом за образами, пока игрок выбирает наряд
    if (kind === 'looks' && url && accentsOn(st) && (a.accents || []).length && !a.accentImage && !a.accentImageFailed) ensurePicture('accents', false);
}
function flushPicture(kind, url) {
    const waiters = [...drawWaitersOf[kind]];
    drawWaitersOf[kind].clear();
    waiters.forEach(fn => { try { fn(url); } catch (e) { /* окно уже закрыто */ } });
}

// ---------- 🎬 Картинка сцены ----------
function canDrawScene() {
    const s = settings();
    if (s.imageSource === 'openai-images') return !!(s.imgApiBase && s.imgApiKey && s.imgApiModel);
    if (s.imageSource) return !!ctx().ConnectionManagerRequestService?.sendRequest;
    return !!imageCommand();
}

function scenePromptRequest(st, mesId) {
    const names = storyNames();
    const msg = Number.isInteger(mesId) ? ctx().chat?.[mesId] : null;
    const moment = msg?.mes ? `Нарисовать нужно момент из этого сообщения (${msg.is_user ? names.user : (msg.name || names.char)}): «${String(msg.mes).replace(/<[^>]+>/g, '').slice(0, 1500)}»` : '';
    const a = st.wardrobe?.active;
    const outfit = a?.status === 'worn' ? `${names.user} сейчас одет(а): ${a.look.en || a.look.desc}${a.accent ? `; ${a.accent.title}` : ''}.` : '';
    const lastAppearance = st.wardrobe?.history?.length ? '' : '';
    return [
        '[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — помощник художника: опиши картинку того, что происходит в сцене прямо сейчас (по последним сообщениям чата).',
        moment,
        st.time?.date ? `Время в истории: ${formatDate(st.time.date)}, ${season(st.time.date).name}${placeLine(st) ? `; место: ${placeLine(st)}` : ''}.` : '',
        outfit,
        lastAppearance,
        'Ответь ровно двумя строками, без пояснений:',
        `CAST: кто в кадре — имена через запятую, как в чате (${[names.user, ...names.chars, ...(st.npcs || []).slice(0, 8).map(n => n.name)].join(', ')})`,
        'SCENE: один абзац по-английски для генератора картинок: место и обстановка, время суток и свет, кто в кадре и как выглядит (внешность, одежда), позы, выражения лиц, настроение, ракурс. Это одна иллюстрация, без текста и подписей.]',
    ].filter(Boolean).join('\n');
}

let sceneDrawing = false;
async function drawScene(popupEl, mesId) {
    if (sceneDrawing) return toastr.info('Сцена уже рисуется', '🎬 Сцена');
    if (!canDrawScene()) return toastr.warning('Не выбрано, чем рисовать: настрой «Чем рисовать» в настройках блокнота.', '🎬 Сцена', { timeOut: 8000 });
    const st = store();
    if (!st || !ctx().chat?.length) return toastr.warning('Сначала открой чат', '🎬 Сцена');
    sceneDrawing = true;
    const status = popupEl?.find('.nnb-scene-status');
    const say = t => status?.text(t);
    try {
        // 1) описание сцены текстовой моделью
        let desc = '';
        let cast = [];
        const raw = await withBusy('🎬 Модель описывает сцену…', () => quietGenerate(scenePromptRequest(st, mesId)));
        for (const line of answerLines(raw || '')) {
            let m = line.match(/^CAST\s*[:：—–-]\s*(.+)$/i);
            if (m) { cast = m[1].split(/[,;]/).map(x => x.trim().toLowerCase().replace(/ё/g, 'е')).filter(Boolean); continue; }
            m = line.match(/^SCENE\s*[:：—–-]\s*(.+)$/i);
            if (m) desc = m[1].trim().replace(/\]$/, '');
        }
        if (!desc) throw new Error('модель не описала сцену — попробуй ещё раз');
        // 2) образцы: аватар персоны и аватары тех, кто в кадре
        say('🎨 Рисую сцену…');
        const names = storyNames();
        const norm = x => String(x || '').toLowerCase().replace(/ё/g, 'е');
        const inFrame = n => !cast.length || cast.some(c => c.includes(norm(n)) || norm(n).includes(c));
        const images = [];
        const who = [];
        if (settings().imageRef) {
            if (inFrame(names.user)) {
                const me = await personaAvatarDataUrl();
                if (me) { images.push(me); who.push(names.user); }
            }
            for (const ch of characterAvatars()) {
                if (images.length >= 4 || !inFrame(ch.name)) continue;
                const img = await fileToDataUrl(ch.file);
                if (img) { images.push(img); who.push(ch.name); }
            }
            for (const npc of (st.npcs || [])) {
                if (images.length >= 4 || !inFrame(npc.name) || !npc.avatar) continue;
                const img = await fileToDataUrl(npc.avatar);
                if (img) { images.push(img); who.push(npc.name); }
            }
        }
        const refs = images.length ? { images, note: `The attached pictures are character references, in this order: ${who.map((n, i) => `${i + 1}) ${n}`).join(', ')}. Keep their faces, hair and features recognizable; clothing, pose and setting follow the description.` } : null;
        const prompt = cleanForCommand(`${desc} Single illustration, no text, no captions.`);
        console.log('[npc_notebook] drawScene: drawing picture...');
        const url = await withTimeout(drawPicture(prompt, refs, imgOrient()), 120000, 'рисунок сцены');
        if (!Array.isArray(st.scenes)) st.scenes = [];
        st.scenes.push({ url, at: ctx().chat.length, date: st.time?.date || '', desc });
        if (st.scenes.length > 100) st.scenes.shift();
        await ctx().saveMetadata();
        renderPanel();
        return url;
    } catch (err) {
        console.warn('[npc_notebook] scene', err);
        toastr.warning(`Сцену нарисовать не вышло: ${escapeHtml(err?.message || err)}`, '🎬 Сцена', { escapeHtml: false, timeOut: 10000 });
        return '';
    } finally {
        sceneDrawing = false;
    }
}

async function attachToLastMessage(url, mesId) {
    const c = ctx();
    for (let i = Number.isInteger(mesId) ? mesId : c.chat.length - 1; i >= 0; i--) {
        const m = c.chat[i];
        if (!m || m.is_system) continue;
        m.extra = m.extra || {};
        const imgDesc = Object.getOwnPropertyDescriptor(m.extra, 'image');
        const newApi = Array.isArray(m.extra.media) || (imgDesc && typeof imgDesc.get === 'function') || typeof c.appendMediaToMessage === 'function';
        if (newApi) {
            // новые версии таверны: картинки лежат в extra.media, а extra.image только для чтения
            if (!Array.isArray(m.extra.media)) m.extra.media = [];
            if (!m.extra.media_display) m.extra.media_display = 'gallery';
            const prevSceneIdx = m.extra.media.findIndex(x => x.title === 'Сцена' || x.source === 'generated');
            if (prevSceneIdx >= 0) {
                m.extra.media[prevSceneIdx] = { url, type: 'image', title: 'Сцена', source: 'generated' };
                m.extra.media_index = prevSceneIdx;
            } else {
                m.extra.media.push({ url, type: 'image', title: 'Сцена', source: 'generated' });
                m.extra.media_index = m.extra.media.length - 1;
            }
        } else {
            m.extra.image = url;
            m.extra.title = 'Сцена';
        }
        m.extra.inline_image = true; // текст поста остаётся на месте
        try { if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(i, m); } catch (e) { /* ignore */ }
        await c.saveChat();
        placeMesButtonsSoon();
        toastr.success('Картинка сцены добавлена в пост. Нажми 🎬 ещё раз, чтобы перерисовать.', '🎬 Сцена', { timeOut: 5000 });
        return;
    }
}

// 🖼 Альбом: сцены и листы образов этого чата
function albumItems(st) {
    const items = [];
    (st.scenes || []).forEach((x, i) => items.push({ kind: 'scene', url: x.url, date: x.date, title: '🎬 Сцена', text: x.desc || '', ref: i }));
    (st.wardrobe?.history || []).forEach((h, i) => { if (h.image) items.push({ kind: 'look', url: h.image, date: h.date, title: `👗 ${h.title}`, text: h.occasion || '', ref: i }); });
    return items.reverse();
}
async function showAlbumItem(item) {
    const st = store();
    const el = $('<div class="nnb-pop nnb-pop-visual"></div>');
    el.append($('<div class="nnb-album-big"></div>').append($('<img alt="">').attr('src', item.url)));
    el.append($('<div class="nnb-look-title"></div>').text([item.title, item.date ? formatDate(item.date) : ''].filter(Boolean).join(' · ')));
    if (item.text) el.append($('<div class="nnb-pop-sub"></div>').text(item.text.length > 300 ? item.text.slice(0, 300) + '…' : item.text));
    const row = $('<div class="nnb-pop-row nnb-pop-links"></div>');
    row.append($('<div class="menu_button"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> Во весь экран</div>').on('click', () => window.open(item.url, '_blank')));
    if (item.kind === 'scene') row.append($('<div class="menu_button"><i class="fa-solid fa-trash"></i> Убрать из альбома</div>').on('click', async () => {
        if (!confirm('Убрать картинку из альбома? В постах она останется.')) return;
        st.scenes.splice(item.ref, 1);
        closePopupOf(el);
        await commit();
    }));
    el.append(row);
    await openPopup(el, true);
}
function renderAlbum(st) {
    const root = $('#nnb_album_box').empty();
    const items = albumItems(st);
    if (!items.length) { root.append('<div class="nnb-empty">Пока пусто: здесь будут картинки сцен (🎬) и листы образов.</div>'); return; }
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`🖼 Альбом (${items.length})`);
    const grid = $('<div class="nnb-album"></div>');
    items.forEach(it => grid.append($('<div class="nnb-album-thumb" tabindex="0"></div>').attr('title', it.title).css('background-image', `url("${String(it.url).replace(/"/g, '%22')}")`).on('click', () => showAlbumItem(it))));
    det.append(grid);
    root.append(det);
}
async function showAlbum() {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    const items = albumItems(st);
    if (!items.length) return toastr.info('Пока пусто: здесь будут картинки сцен (🎬) и листы образов.', '🖼 Альбом');
    const el = $('<div class="nnb-pop nnb-pop-visual"><h3>🖼 Альбом</h3></div>');
    const grid = $('<div class="nnb-album"></div>');
    items.forEach(it => grid.append($('<div class="nnb-album-thumb" tabindex="0"></div>').attr('title', it.title).css('background-image', `url("${String(it.url).replace(/"/g, '%22')}")`).on('click', () => { closePopupOf(el); showAlbumItem(it); })));
    el.append(grid);
    await openPopup(el, true);
}

// 🎬: рисуем в фоне и сразу ставим картинку в пост (тот, на котором нажали, или последний)
async function showScenePopup(mesId) {
    if (!Number.isInteger(mesId)) mesId = undefined;
    if (sceneDrawing) return toastr.info('Сцена уже рисуется — картинка появится в посте сама', '🎬 Сцена');
    const note = toastr.info('Рисую сцену… Нажми на уведомление, чтобы скрыть.', '🎬 Сцена', { timeOut: 60000, extendedTimeOut: 15000, tapToDismiss: true });
    let url = '';
    try {
        url = await drawScene(null, mesId);
    } catch (e) {
        console.error('[npc_notebook] showScenePopup error:', e);
    } finally {
        sceneDrawing = false;
        try { toastr.clear(note); } catch (e) { /* ignore */ }
    }
    if (url) await attachToLastMessage(url, mesId);
}

// Окно выбора открываем, когда картинка уже готова (или не получилась)
const presentWaiting = { looks: null, accents: null, gacha: null };
function openWhenReady(kind, openFn) {
    const a = activeOf(kind);
    const [field, failField] = PIC_FIELDS[kind];
    const needsPic = wantImages() && a && (kind !== 'accents' || (a.accents || []).length);
    if (!needsPic || a[field] || a[failField]) return openFn();
    if (presentWaiting[kind]) return; // уже ждём — окно откроется само
    const msg = { looks: 'Рисую образы… Окно выбора откроется само, а пока можно читать чат.', accents: 'Рисую штрихи… Окно откроется само.', gacha: 'Раскладываю находки на прилавке… Окно откроется само.' }[kind];
    presentWaiting[kind] = toastr.info(msg, kind === 'gacha' ? '🎰 Находки' : '🎨 Гардероб', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });
    ensurePicture(kind, false, () => {
        try { toastr.clear(presentWaiting[kind]); } catch (e) { /* ignore */ }
        presentWaiting[kind] = null;
        openFn();
    });
}
const presentLooks = () => openWhenReady('looks', showWardrobePopup);
const presentAccents = () => openWhenReady('accents', showAccentPopup);

// Общий визуальный выбор: картинка с зонами, кнопки с названиями, свёрнутые описания
// Находим на общей картинке, где стоит каждая фигура/предмет: делим на N колонок и в каждой
// ищем область, заметно отличную от фона. Возвращает [{x,y,w,h}] в долях картинки.
const cropCache = new Map();
function smartCrops(url, n, kind, layout) {
    const rowsN = layout?.rows || 1, colsN = layout?.cols || n;
    const key = `${url}|${n}|${kind}|${rowsN}x${colsN}`;
    if (cropCache.has(key)) return cropCache.get(key);
    if (typeof Image !== 'function') return Promise.resolve([]);
    const job = new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const W = 240, H = Math.max(1, Math.round(240 * img.naturalHeight / img.naturalWidth));
                const cv = document.createElement('canvas');
                cv.width = W; cv.height = H;
                const g = cv.getContext('2d', { willReadFrequently: true });
                g.drawImage(img, 0, 0, W, H);
                const d = g.getImageData(0, 0, W, H).data;
                // цвет фона — по углам
                const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
                // фон оцениваем построчно по левому и правому краю: у фото он часто плавно меняется сверху вниз
                const mx = Math.max(1, Math.round(W * 0.03));
                const rowBg = [];
                for (let y = 0; y < H; y++) {
                    const pts = [];
                    for (let x = mx; x < mx + 4; x++) pts.push(px(x, y));
                    for (let x = W - mx - 4; x < W - mx; x++) pts.push(px(x, y));
                    rowBg.push([0, 1, 2].map(k => pts.reduce((s2, c) => s2 + c[k], 0) / pts.length));
                }
                const isFg = (x, y) => { const c = px(x, y), b = rowBg[y]; return Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]) + Math.abs(c[2] - b[2]) > 70; };
                const mid = rowBg[Math.floor(H / 2)] || [244, 241, 238];
                const bg = `rgb(${mid.map(v => Math.round(v)).join(',')})`;
                // предметы в ряд: художник редко ставит их ровно по третям — ищем каждый предмет по пустым промежуткам
                if (kind !== 'looks' && rowsN === 1) {
                    const segs = itemSegments(W, H, isFg, n);
                    if (segs) { segs.bg = bg; resolve(segs); return; }
                }
                const out = [];
                for (let i = 0; i < n; i++) {
                    const r = Math.floor(i / colsN), c = i % colsN;
                    const x0 = Math.floor(c * W / colsN), x1 = Math.floor((c + 1) * W / colsN);
                    const y0 = Math.floor(r * H / rowsN), y1 = Math.floor((r + 1) * H / rowsN);
                    const colW = x1 - x0, cellH = y1 - y0;
                    // плотность «не фона» по строкам и столбцам ячейки — шум и тени не считаем
                    const rows = new Array(cellH).fill(0), cols = new Array(colW).fill(0);
                    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (isFg(x, y)) { rows[y - y0]++; cols[x - x0]++; }
                    const rowsOk = rows.map(v => v > colW * 0.04), colsOk = cols.map(v => v > cellH * 0.03);
                    let minY = rowsOk.indexOf(true), maxY = rowsOk.lastIndexOf(true);
                    let minX = colsOk.indexOf(true), maxX = colsOk.lastIndexOf(true);
                    if (minY < 0 || minX < 0) { out.push(null); continue; }
                    minX += x0; maxX += x0; minY += y0; maxY += y0;
                    const pad = 0.08;
                    let w = (maxX - minX) * (1 + pad * 2), h = (maxY - minY) * (1 + pad * 2);
                    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
                    const target = kind === 'looks' ? (rowsN === 2 ? 2 / 3 : 0.5) : 1;
                    if (w / h < target) w = Math.min(colW * 0.88, h * target);
                    if (w / h > target) h = Math.min(cellH * 0.88, w / target);
                    w = Math.min(w, colW * 0.88); h = Math.min(h, cellH * 0.88);
                    const safePadX = colW * 0.06, safePadY = cellH * 0.06;
                    const x = Math.max(x0 + safePadX, Math.min(x1 - safePadX - w, cx - w / 2));
                    const y = Math.max(y0 + safePadY, Math.min(y1 - safePadY - h, cy - h / 2));
                    out.push({ x: x / W, y: y / H, w: w / W, h: h / H });
                }
                out.bg = bg;
                resolve(out);
            } catch (e) {
                resolve([]); // картинка с другого сайта без разрешения — режем поровну
            }
        };
        img.onerror = () => resolve([]);
        img.crossOrigin = 'anonymous';
        img.src = url;
    });
    cropCache.set(key, job);
    return job;
}
// Делим полосу с предметами на n кусков по пустым промежуткам между ними; null — если не вышло
function itemSegments(W, H, isFg, n) {
    const colCnt = new Array(W).fill(0);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (isFg(x, y)) colCnt[x]++;
    const peak = Math.max(...colCnt);
    const on = colCnt.map(v => v > Math.max(H * 0.015, peak * 0.08)); // фон с виньеткой тоже даёт немного «не фона» — считаем от самого плотного столбца
    let runs = [];
    for (let x = 0; x < W; x++) {
        if (!on[x]) continue;
        const last = runs[runs.length - 1];
        if (last && x - last.x1 <= Math.max(2, W * 0.015)) last.x1 = x; else runs.push({ x0: x, x1: x });
    }
    runs.forEach(r => { r.mass = colCnt.slice(r.x0, r.x1 + 1).reduce((a, b) => a + b, 0); });
    runs = runs.filter(r => r.mass > H * 2); // соринки и тени не считаем
    if (!runs.length) return null;
    // предметы слиплись — режем самый широкий кусок по самому «пустому» месту в его середине
    while (runs.length < n) {
        const wi = runs.reduce((b, r, i) => (r.x1 - r.x0 > runs[b].x1 - runs[b].x0 ? i : b), 0);
        const r = runs[wi];
        if (r.x1 - r.x0 < W * 0.12) return null;
        const a0 = Math.round(r.x0 + (r.x1 - r.x0) * 0.2), a1 = Math.round(r.x1 - (r.x1 - r.x0) * 0.2);
        let cut = a0;
        for (let x = a0; x <= a1; x++) if (colCnt[x] < colCnt[cut]) cut = x;
        const m = (x0, x1) => colCnt.slice(x0, x1 + 1).reduce((a, b) => a + b, 0);
        runs.splice(wi, 1, { x0: r.x0, x1: cut - 1, mass: m(r.x0, cut - 1) }, { x0: cut + 1, x1: r.x1, mass: m(cut + 1, r.x1) });
    }
    // если кусков больше — склеиваем ближайшие соседние, пока не останется n
    while (runs.length > n) {
        let best = 0, gap = Infinity;
        for (let i = 0; i < runs.length - 1; i++) { const g = runs[i + 1].x0 - runs[i].x1; if (g < gap) { gap = g; best = i; } }
        const a = runs[best], b = runs[best + 1];
        runs.splice(best, 2, { x0: a.x0, x1: b.x1, mass: a.mass + b.mass });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
        const r = runs[i];
        const left = i ? Math.ceil((runs[i - 1].x1 + r.x0) / 2) : 0;
        const right = i < n - 1 ? Math.floor((r.x1 + runs[i + 1].x0) / 2) : W - 1;
        let minY = H, maxY = -1;
        for (let y = 0; y < H; y++) {
            let c = 0;
            for (let x = r.x0; x <= r.x1; x++) if (isFg(x, y)) c++;
            if (c > (r.x1 - r.x0 + 1) * 0.04) { if (y < minY) minY = y; maxY = y; }
        }
        if (maxY < 0) return null;
        const cx = (r.x0 + r.x1) / 2, cy = (minY + maxY) / 2;
        const padX = Math.round((right - left) * 0.06);
        const safeLeft = left + padX, safeRight = right - padX;
        const h = Math.min(H * 0.9, Math.max(r.x1 - r.x0, maxY - minY) * 1.2);
        const w = Math.min(safeRight - safeLeft, Math.max(h, (r.x1 - r.x0) * 1.15));
        const x = Math.max(safeLeft, Math.min(safeRight - w, cx - w / 2));
        const y = Math.max(0, Math.min(H - h, cy - h / 2));
        out.push({ x: x / W, y: y / H, w: w / W, h: h / H });
    }
    return out;
}

function applyCrop(el, url, box, imgRatio) {
    if (el.hasClass('nnb-card-img')) {
        let inner = el.children('.nnb-card-crop');
        if (!inner.length) inner = $('<div class="nnb-card-crop"></div>').appendTo(el);
        el = inner;
    }
    const bw = Math.max(0.01, Math.min(1, box.w));
    const bh = Math.max(0.01, Math.min(1, box.h));
    const posX = bw >= 1 ? 50 : Math.max(0, Math.min(1, box.x / (1 - bw))) * 100;
    const posY = bh >= 1 ? 50 : Math.max(0, Math.min(1, box.y / (1 - bh))) * 100;
    el.css({
        'background-image': `url("${String(url).replace(/"/g, '%22')}")`,
        'background-size': `${100 / bw}% ${100 / bh}%`,
        'background-position': `${posX}% ${posY}%`,
        'aspect-ratio': `${(bw * imgRatio) / bh}`,
    });
}

// Общая картинка нарезается на карточки: в каждой своя фигура или предмет и название
function visualPicker({ kind, items, title, label, onPick, field, failField, a, cardClass }) {
    const box = $('<div class="nnb-visual"></div>');
    const n = Math.min(items.length, kind === 'gacha' ? 3 : 4);
    const layoutOf = () => a[field + 'Layout'] || (kind === 'accents' ? accentsLayout(n) : { rows: 1, cols: n });
    const cell = i => {
        const L = layoutOf();
        const r = Math.floor(i / L.cols), c = i % L.cols;
        const colW = 1 / L.cols, rowH = 1 / L.rows;
        const padX = colW * 0.08, padY = rowH * 0.08;
        return {
            x: c * colW + padX,
            y: r * rowH + padY,
            w: colW - padX * 2,
            h: rowH - padY * 2
        };
    };
    const render = url => {
        box.empty();
        const head = $('<div class="nnb-visual-tools"></div>');
        const redraw = $('<div class="nnb-icon-btn fa-solid fa-palette" title="Перерисовать" tabindex="0"></div>').on('click', () => { wait(); ensurePicture(kind, !drawingKind[kind], render); });
        head.append(redraw);
        if (url) head.append($('<div class="nnb-icon-btn fa-solid fa-up-right-and-down-left-from-center" title="Во весь экран" tabindex="0"></div>').on('click', () => window.open(url, '_blank')));
        box.append(head);
        const grid = $(`<div class="nnb-cards nnb-cards-${kind}${url ? ' nnb-carousel' : ' nnb-cards-text'}${layoutOf().rows === 2 ? ' nnb-grid22' : ''}"></div>`);
        const imgs = [];
        items.forEach((it, i) => {
            const card = $('<div class="nnb-card-pick" tabindex="0"><div class="nnb-card-body"><div class="nnb-card-kind"></div><div class="nnb-card-title"></div></div></div>');
            if (cardClass) card.addClass(cardClass(it));
            if (url && i < n) {
                const img = $('<div class="nnb-card-img"></div>');
                // пока ищем фигуру — режем поровну
                applyCrop(img, url, cell(i), layoutOf().rows === 2 ? 2 / 3 : 1.5);
                card.prepend(img);
                imgs.push(img);
            }
            const kindText = label ? label(it) : '';
            if (kindText) card.find('.nnb-card-kind').text(kindText); else card.find('.nnb-card-kind').remove();
            card.find('.nnb-card-title').text(title(it));
            if (it.desc) card.find('.nnb-card-body').append($('<div class="nnb-card-desc"></div>').text(it.desc));
            card.on('click', () => onPick(i));
            grid.append(card);
        });
        box.append(grid);
        // карусель: по одной карточке на экран, листаем пальцем; точки внизу показывают, где мы
        if (url && items.length > 1) {
            const dots = $('<div class="nnb-dots"></div>');
            items.forEach((_, i) => dots.append($('<span tabindex="0"></span>').on('click', () => { const el = grid[0]; el.scrollTo?.({ left: i * el.clientWidth, behavior: 'smooth' }); })));
            const mark = () => { const el = grid[0]; const i = el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0; dots.children().each((j, d) => $(d).toggleClass('active', j === i)); };
            grid.on('scroll', mark);
            mark();
            box.append(dots);
        }
        if (url && imgs.length && typeof Image === 'function') {
            const probe = new Image();
            probe.onload = async () => {
                const ratio = probe.naturalWidth / probe.naturalHeight || 1.5;
                const crops = await smartCrops(url, n, kind, layoutOf());
                imgs.forEach((el, i) => { applyCrop(el, url, crops[i] || cell(i), ratio); if (crops.bg) el.css('background-color', crops.bg); });
            };
            probe.src = url;
        }
    };
    const wait = () => box.html('').append($('<div class="nnb-pop-sub nnb-wait"></div>').text(`🎨 Рисую через ${imageSourceName()}… обычно до пары минут`));
    if (a[field]) render(a[field]);
    else if (a[failField] && !drawingKind[kind]) render('');
    else { wait(); ensurePicture(kind, false, render); }
    return box;
}

function parseLooks(raw) {
    const looks = [];
    const accents = [];
    let appearance = '';
    let last = null;
    for (const line of answerLines(raw)) {
        let m = line.match(/^APPEARANCE\s*[:：—–-]\s*(.+)$/i);
        if (m) { appearance = m[1].trim(); continue; }
        m = line.match(/^EN\s*[:：—–-]\s*(.+)$/i);
        if (m) { if (last) last.en = m[1].trim().replace(/\]$/, ''); continue; }
        m = line.match(/^LOOK\s*\d*\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const parts = m[1].split('|').map(x => x.trim());
            let category = 'Повседневный';
            let title = '';
            let desc = '';
            if (parts.length >= 3 && /^(повседнев|рабоч|учеб|на выход|вечер|домаш|по погоде|улич|спорт|актив)/i.test(parts[0])) {
                category = normalizeClosetCat(parts[0]);
                title = parts[1].replace(/^[«"]|[»"]$/g, '');
                desc = parts.slice(2).join(' | ').trim();
            } else {
                title = (parts[0] || '').replace(/^[«"]|[»"]$/g, '');
                desc = parts.slice(1).join(' | ').trim();
            }
            last = { category, title, desc, effects: '' };
            looks.push(last);
            continue;
        }
        m = line.match(/^ACCENT\s*\d*\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const parts = m[1].split('|').map(x => x.trim());
            const kind = accentKind(parts[0]);
            const title = (parts.length >= 3 ? parts[1] : parts[0]).replace(/^[«"]|[»"]$/g, '');
            const desc = parts.length >= 3 ? parts.slice(2).join(' | ') : (parts[1] || '');
            last = { kind, title, desc: desc.replace(/\]$/, ''), effects: '' };
            if (title) accents.push(last);
            continue;
        }
        m = line.match(/^EFFECTS?\s*[:：—–-]\s*(.+)$/i);
        if (m && last) last.effects = m[1].trim().replace(/\]$/, '');
    }
    const out = looks.filter(l => l.title);
    out.appearance = appearance;
    out.accents = accents;
    return out;
}

async function generateOutfits(st, occasion, exclude = []) {
    const raw = await quietGenerate(wardrobePrompt(st, occasion, exclude));
    st.lastRaw = String(raw ?? '');
    const looks = parseLooks(raw);
    if (looks.length < 2) {
        toastr.warning('Модель не предложила образы по формату — загляни в «Последний ответ модели»', 'Блокнот рассказчика');
        return false;
    }
    st.wardrobe.active = { occasion: occasion || '', options: looks.slice(0, 5), appearance: looks.appearance, accents: looks.accents || [], status: 'choosing', at: ctx().chat.length, date: st.time.date || '' };
    return true;
}

async function promptGenerateNewOutfits(defaultOccasion = '') {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    const occasion = await askText('Под какой повод или сезон сгенерировать 5 новых образов? (Оставь пустым — модель поймёт по текущей сцене)', defaultOccasion);
    if (occasion === null) return;
    st.wardrobe.active = null;
    const ok = await withBusy('👗 Модель придумывает 5 новых образов…', s2 => generateOutfits(s2, occasion.trim()));
    if (ok) presentLooks();
}

async function wearFromCloset(item, occasion = '') {
    const st = store();
    if (!st || !item) return;
    st.wardrobe.active = {
        occasion: occasion || item.category || 'Из шкафа',
        look: { title: item.title, desc: item.desc, en: item.en || '', effects: item.effects || '', category: item.category },
        options: [item],
        accents: [],
        status: 'worn',
        at: ctx().chat.length,
        date: st.time.date || '',
    };
    await commit();
    if (accentsOn(st) && wearableBox(st).length) {
        presentAccents();
        return;
    }
    toastr.success(`Надет образ «${escapeHtml(item.title)}» (${escapeHtml(item.category || 'Из шкафа')}).`, '👗 Гардероб', { escapeHtml: false });
    await checkPendingTravel();
}

async function openClosetPopup() {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (st.wardrobe.active?.status === 'choosing') return presentLooks();

    if (!Array.isArray(st.wardrobe.closet)) st.wardrobe.closet = [];
    const el = $('<div class="nnb-pop"><h3>👗 Гардероб и шкаф</h3></div>');

    const a = st.wardrobe.active;
    if (a?.status === 'worn' && a.look) {
        const curBox = $('<div class="nnb-note nnb-event" style="margin-bottom:10px;"></div>');
        curBox.append($('<div class="nnb-event-title"></div>').text(`Сейчас надето: «${a.look.title}»${a.occasion ? ` (${a.occasion})` : ''}`));
        curBox.append($('<div class="nnb-npc-text" style="margin-top:4px;"></div>').text(a.look.desc + (a.accent ? `\n${(ACCENT_KINDS[a.accent.kind] || ACCENT_KINDS.accessory).icon} Штрих: ${a.accent.title}` : '')));
        const curBtns = $('<div class="nnb-pop-row" style="margin-top:8px;"></div>');
        if (accentsOn(st) && wearableBox(st).length) {
            curBtns.append($('<div class="menu_button"><i class="fa-solid fa-spray-can-sparkles"></i> Штрих из шкатулки</div>').on('click', () => { closePopupOf(el); presentAccents(); }));
        }
        curBtns.append($('<div class="menu_button"><i class="fa-solid fa-masks-theater"></i> Итог образа</div>').on('click', () => { closePopupOf(el); runReveal(); }));
        curBtns.append($('<div class="menu_button"><i class="fa-solid fa-xmark"></i> Снять</div>').on('click', async () => {
            st.wardrobe.active = null;
            await commit();
            closePopupOf(el);
            toastr.info('Текущий наряд снят', '👗 Гардероб');
        }));
        curBox.append(curBtns);
        el.append(curBox);
    }

    let curCat = 'Все';
    const catRow = $('<div class="nnb-chips-row" style="margin-bottom:8px;"></div>');
    const listWrap = $('<div class="nnb-looks" style="max-height:360px; overflow-y:auto;"></div>');

    const renderList = () => {
        listWrap.empty();
        const items = st.wardrobe.closet.filter(c => curCat === 'Все' || c.category === curCat);
        if (!items.length) {
            listWrap.append(`<div class="nnb-empty">${st.wardrobe.closet.length ? 'В этой категории пока нет сохранённых нарядов.' : 'Шкаф пока пуст. Сгенерируй 5 новых вариантов или создай стартовый мир (10 нарядов сразу по сезону)!'}</div>`);
            return;
        }
        items.forEach(item => {
            const isWorn = a?.status === 'worn' && a.look?.title === item.title;
            const card = $('<div class="nnb-look" style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;"></div>');
            if (isWorn) card.css('border-color', 'var(--SmartThemeQuoteColor, #8b78c4)');
            const left = $('<div style="flex:1; min-width:0; cursor:pointer;"></div>');
            left.append($('<div class="nnb-look-title"></div>').text(`${isWorn ? '👕 ' : ''}«${item.title}» · ${item.category || 'Повседневный'}`));
            left.append($('<div class="nnb-look-desc"></div>').text(item.desc));
            left.on('click', async () => {
                closePopupOf(el);
                await wearFromCloset(item);
            });
            const acts = $('<div class="nnb-actions" style="flex-shrink:0;"></div>');
            const wearBtn = $('<i class="fa-solid fa-shirt" title="Надеть сейчас (без запросов)"></i>').on('click', async (e) => {
                e.stopPropagation();
                closePopupOf(el);
                await wearFromCloset(item);
            });
            const editBtn = $('<i class="fa-solid fa-pen" title="Изменить"></i>').on('click', async (e) => {
                e.stopPropagation();
                const t = await askText('Название образа', item.title);
                if (t === null) return;
                const c = await askText('Категория (Повседневный, Рабочий, На выход, Домашний, По погоде, Спортивный)', item.category || 'Повседневный');
                if (c === null) return;
                const d = await askText('Описание наряда', item.desc);
                if (d === null) return;
                if (t.trim()) item.title = t.trim();
                item.category = normalizeClosetCat(c);
                item.desc = d.trim();
                await commit();
                renderList();
            });
            const delBtn = $('<i class="fa-solid fa-trash" title="Удалить из шкафа"></i>').on('click', async (e) => {
                e.stopPropagation();
                st.wardrobe.closet = st.wardrobe.closet.filter(x => x.id !== item.id);
                await commit();
                renderList();
            });
            acts.append(wearBtn, editBtn, delBtn);
            card.append(left, acts);
            listWrap.append(card);
        });
    };

    ['Все', ...CLOSET_CATEGORIES].forEach(cat => {
        const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(cat);
        if (cat === curCat) chip.addClass('active');
        chip.on('click', () => {
            curCat = cat;
            catRow.find('.nnb-travel-chip').removeClass('active');
            chip.addClass('active');
            renderList();
        });
        catRow.append(chip);
    });

    el.append('<div class="nnb-pop-sub">Переодевайся в любой момент из шкафа (0 запросов) или сгенерируй 5 новых вариантов:</div>');
    el.append(catRow, listWrap);
    renderList();

    const botRow = $('<div class="nnb-pop-row nnb-pop-links" style="margin-top:12px;"></div>');
    const gen5Btn = $('<div class="menu_button nnb-btn-primary"><i class="fa-solid fa-wand-magic-sparkles"></i> Сгенерировать 5 новых вариантов</div>').on('click', async () => {
        closePopupOf(el);
        await promptGenerateNewOutfits(curCat !== 'Все' ? curCat : '');
    });
    const addManualBtn = $('<div class="menu_button"><i class="fa-solid fa-plus"></i> Свой наряд в шкаф</div>').on('click', async () => {
        const t = await askText('Название образа (например «Уютный осенний свитер»)');
        if (!t || !t.trim()) return;
        const c = await askText('Категория (Повседневный, Рабочий, На выход, Домашний, По погоде, Спортивный)', curCat !== 'Все' ? curCat : 'Повседневный');
        if (c === null) return;
        const d = await askText('Описание: что надето, обувь, причёска, детали');
        if (d === null) return;
        const added = addLookToCloset(st, { title: t.trim(), category: c.trim(), desc: d.trim() });
        await commit();
        renderList();
        if (added && confirm(`Наряд «${added.title}» добавлен в шкаф! Надеть его прямо сейчас?`)) {
            closePopupOf(el);
            await wearFromCloset(added);
        }
    });
    botRow.append(gen5Btn, addManualBtn);
    el.append(botRow);

    await openPopup(el);
}

async function startWardrobe() {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (st.wardrobe.active?.status === 'choosing') return presentLooks();
    return openClosetPopup();
}

async function rerollOutfits() {
    const st = store();
    const a = st?.wardrobe.active;
    if (!a) return;
    const exclude = a.options.map(o => o.title);
    const occasion = a.occasion;
    const ok = await withBusy('👗 Модель подбирает 5 других образов…', s2 => generateOutfits(s2, occasion, exclude));
    if (ok) presentLooks();
}

async function chooseOutfit(i, customText, extraSaveIndices = []) {
    const st = store();
    const a = st?.wardrobe.active;
    if (!a) return;
    if (customText) {
        const customLook = { title: 'Свой образ', desc: customText, effects: '', custom: true, category: normalizeClosetCat(a.occasion) };
        addLookToCloset(st, customLook, customLook.category);
        a.look = customLook;
    } else {
        const allToSave = new Set([i, ...(extraSaveIndices || [])].filter(idx => idx >= 0 && idx < a.options.length));
        allToSave.forEach(idx => addLookToCloset(st, a.options[idx], normalizeClosetCat(a.options[idx].category || a.occasion)));
        a.look = a.options[i];
    }
    a.status = 'worn';
    await commit();
    if (accentsOn(st) && ((a.accents || []).length || wearableBox(st).length)) {
        presentAccents();
        return;
    }
    toastr.success(`Выбран образ «${escapeHtml(a.look.title)}» (сохранено в шкаф).`, '👗 Гардероб', { escapeHtml: false });
    await checkPendingTravel();
}

async function chooseAccent(accent) {
    const st = store();
    const a = st?.wardrobe.active;
    if (!a || a.status !== 'worn') return;
    a.accent = accent || null;
    await commit();
    toastr.success(`Образ «${escapeHtml(a.look.title)}»${accent ? ` + ${escapeHtml(accent.title)}` : ''}. Последствия узнаешь по ходу сцены.`, '👗 Гардероб', { escapeHtml: false });
    await checkPendingTravel();
}

async function showAccentPopup() {
    const st = store();
    const a = st?.wardrobe.active;
    if (!a || a.status !== 'worn') return;
    const accents = a.accents || [];
    const visual = wantImages() && accents.length > 0;
    const el = $(`<div class="nnb-pop${visual ? ' nnb-pop-visual' : ''}"><h3>✨ Добавить штрих?</h3></div>`);
    el.append($('<div class="nnb-pop-sub"></div>').text(`К образу «${a.look.title}»`));
    const icon = k => (ACCENT_KINDS[k] || ACCENT_KINDS.accessory).icon;
    const pickAccent = async i => { closePopupOf(el); await chooseAccent(accents[i]); };
    const card = (title, desc, sub, fn) => {
        const c = $('<div class="nnb-look" tabindex="0"><div class="nnb-look-title"></div><div class="nnb-look-desc"></div></div>');
        c.find('.nnb-look-title').text(title);
        c.find('.nnb-look-desc').text([desc, sub].filter(Boolean).join(' · '));
        c.on('click', async () => { closePopupOf(el); await fn(); });
        return c;
    };
    if (visual) {
        el.append(visualPicker({ kind: 'accents', items: accents, title: x => x.title, label: x => (ACCENT_KINDS[x.kind] || ACCENT_KINDS.accessory).name, onPick: pickAccent, field: 'accentImage', failField: 'accentImageFailed', a }));
    } else {
        accents.forEach((ac, i) => el.append(card(`${icon(ac.kind)} ${ac.title}`, ac.desc, '', () => chooseAccent(accents[i]))));
    }
    const fresh = wearableBox(st).filter(x => !accents.some(ac => ac.title.toLowerCase() === x.title.toLowerCase()));
    if (fresh.length) {
        el.append('<div class="nnb-pop-sub nnb-box-head">🎁 Из шкатулки</div>');
        const boxRow = $('<div class="nnb-chips-row"></div>');
        fresh.forEach(x => boxRow.append($('<div class="menu_button nnb-look-chip" tabindex="0"></div>').text(`${icon(x.kind)} ${x.title}`).attr('title', x.origin || '')
            .on('click', async () => { closePopupOf(el); await chooseAccent({ kind: x.kind === 'find' ? 'pocket' : x.kind, title: x.title, desc: x.desc, origin: x.origin, effects: '', fromBox: true }); })));
        el.append(boxRow);
    }
    const none = $('<div class="menu_button"><i class="fa-solid fa-xmark"></i> Без штриха</div>');
    none.on('click', async () => { closePopupOf(el); await chooseAccent(null); });
    el.append($(`<div class="nnb-pop-row${visual ? ' nnb-pop-links' : ''}"></div>`).append(none));
    if (!(await openPopup(el, visual))) await chooseAccent(null);
    if (st?.map?.pendingTravel) await chooseAccent(null);
}

// ---------- 🎰 Находки и варианты (гача) ----------
const RARITIES = [
    {
        id: 'common', name: 'Обычная', icon: '⚪', stars: '★', w: 60,
        hint: 'милая простая вещица; в сцене — лёгкий приятный момент, повод улыбнуться',
        choiceHint: 'приятный, жизненный и уютный вариант; даёт живую бытовую деталь и хорошее настроение в сцене',
    },
    {
        id: 'rare', name: 'Редкая', icon: '🔵', stars: '★★', w: 28,
        hint: 'вещь со своей историей: необычная деталь, надпись, след прежнего владельца — за неё цепляется разговор',
        choiceHint: 'вариант с изюминкой, необычной атмосферой, интригующей деталью или совпадением — за него сразу цепляется разговор и действие',
    },
    {
        id: 'epic', name: 'Эпическая', icon: '🟣', stars: '★★★', w: 10,
        hint: 'вещь связана с кем-то из героев или их прошлым — её узнают, она заметно меняет настроение сцены',
        choiceHint: 'вариант тесно переплетён с прошлым, вкусами, мечтами или скрытыми чувствами кого-то из героев — вызывает сильный отклик и двигает отношения или сюжет',
    },
    {
        id: 'legendary', name: 'Легендарная', icon: '🟡', stars: '★★★★', w: 2,
        hint: 'вещь с тайной: открывает новую сюжетную линию, загадку или поворот, о котором ещё никто не знает',
        choiceHint: 'судьбоносный или таинственный вариант: открывает новую сюжетную линию, неожиданное знакомство, секрет или поворот, о котором ещё никто не подозревает',
    },
];
const GACHA_PITY = 10;          // столько прокруток без эпической — и следующая гарантирована
const GACHA_LIMIT = 3;          // прокруток на один пост
const rarityOf = id => RARITIES.find(r => r.id === id) || RARITIES[0];
function rollRarity() {
    let x = Math.random() * RARITIES.reduce((a, r) => a + r.w, 0);
    for (const r of RARITIES) { if ((x -= r.w) < 0) return r.id; }
    return 'common';
}
// три редкости на прокрутку; гарант считает прокрутки без эпической и выше
function rollGacha(g) {
    const out = [rollRarity(), rollRarity(), rollRarity()];
    const high = id => id === 'epic' || id === 'legendary';
    if (!out.some(high) && (g.pity || 0) + 1 >= GACHA_PITY) out[Math.floor(Math.random() * 3)] = 'epic';
    g.pity = out.some(high) ? 0 : (g.pity || 0) + 1;
    return out;
}
function gachaOn(st) {
    return !!st?.direction?.gacha;
}
function gachaSpinsLeft(st) {
    const len = ctx().chat?.length ?? 0;
    st.gacha.spins = st.gacha.spins.filter(at => at === len); // с новым постом счёт начинается заново
    return Math.max(0, GACHA_LIMIT - st.gacha.spins.length);
}

function gachaPrompt(st, rarities, hint, mode = 'items') {
    const names = storyNames();
    const t = st.time;
    const when = [t.date ? `${formatDate(t.date)}, ${season(t.date).name}` : '', placeLine(st)].filter(Boolean).join('; ');
    if (mode === 'choices') {
        const recentChoices = (st.gacha.choices || []).slice(-12).map(x => x.title);
        const lines = [
            '[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — помощник автора и устраиваешь «гачу вариантов»: игрок испытывает удачу и получает три варианта на выбор (НЕ предметы для инвентаря, а события, занятия, места, профессии, книги/фильмы, знакомства или решения).',
            hint
                ? `Тема розыгрыша от игрока: «${hint}». Придумай три разных варианта именно на эту тему (например, если это книга или фильм — три конкретных названия с жанром и о чём они; если профессия или подработка — три вакансии/роли с условиями; если куда пойти — три колоритных места; если знакомство — три интересных человека).`
                : `Пойми по последним сообщениям чата, какой выбор или случай сейчас интереснее всего для ${names.user}: куда сходить, какую книгу почитать или фильм посмотреть на вечер, какую подработку/профессию выбрать, какое блюдо заказать, с кем случайно познакомиться или чем заняться. Выбери одну самую подходящую к сцене тему и предложи три варианта внутри неё.`,
            when ? `Когда и где: ${when}. Учитывай реалии, атмосферу и местную валюту (если уместно).` : '',
            buildDirection(st),
            recentChoices.length ? `Уже выпадало ранее (не повторяй): ${recentChoices.join(', ')}.` : '',
            'Редкость каждого варианта уже выпала, придумай их строго под неё, в этом порядке:',
            ...rarities.map((r, i) => `${i + 1}) ${rarityOf(r).name.toUpperCase()} — ${rarityOf(r).choiceHint}`),
            `Все три варианта должны заметно отличаться по настроению и сути. У каждого — скрытый «крючок»: чем обернётся этот выбор в сюжете, если ${names.user} выберет именно его (какая сцена начнётся, кто как отреагирует, что откроется). Крючок — для автора, игрок его заранее не видит. Персонажи и тайны — только из этой истории.`,
            'Формат, без пояснений:',
            'PLACE: короткое название темы (например «Книга на вечер», «Вакансия», «Куда пойти», «Случайная встреча»)',
            'Затем по одной строке на каждый из 3 вариантов:',
            'ITEM: название варианта | описание в 1–2 предложениях | короткая деталь (жанр, условия, особенность или где это) | сюжетный крючок',
        ];
        return lines.filter(Boolean).join('\n') + ']';
    }
    const owned = st.wardrobe.box.slice(-12).map(x => x.title);
    const images = wantImages();
    const lines = [
        '[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — помощник автора и устраиваешь «гачу»: игрок испытывает удачу и получает три вещественные находки (осязаемые предметы) на выбор.',
        hint ? `Где это происходит или что ищем: ${hint}.` : `Пойми по последним сообщениям чата, где сейчас ${names.user}: блошиный рынок, лоток с винтажем, антикварная лавка, капсульный автомат, лотерея на ярмарке, коробка на чердаке и т.п. Находки должны быть именно оттуда. Если подходящего места в сцене нет — придумай уместный повод рядом (уличный торговец, автомат у входа, коробка «отдам даром»).`,
        when ? `Когда и где: ${when}. Цену пиши в местной валюте и в духе этого места.` : 'Цену пиши в валюте, уместной для этого мира.',
        buildDirection(st),
        owned.length ? `У ${names.user} уже есть: ${owned.join(', ')} — не повторяй.` : '',
        'Редкость каждой находки уже выпала, придумай предметы строго под неё, в этом порядке:',
        ...rarities.map((r, i) => `${i + 1}) ${rarityOf(r).name.toUpperCase()} — ${rarityOf(r).hint}`),
        `Все три предмета разные и осязаемые (их можно положить в шкатулку или взять в руки). У каждого — «крючок»: что произойдёт в следующей сцене, если ${names.user} возьмёт именно его (кто заметит, что вспомнится, что откроется). Крючок — для автора, игрок его не видит. Персонажи и тайны — только из этой истории.`,
        'Формат, без пояснений:',
        'PLACE: короткое название места или лотка',
        `Затем по ${images ? 'две строки' : 'одной строке'} на находку:`,
        'ITEM: название | как выглядит — одно предложение | цена | крючок',
    ];
    if (images) lines.push('EN: этот же предмет коротко по-английски, только как он выглядит');
    return lines.filter(Boolean).join('\n') + ']';
}
function parseGacha(raw, rarities) {
    const text = String(raw || '').replace(/\*\*/g, '');
    const place = (text.match(/^\s*(?:PLACE|TOPIC)\s*[:：—–-]\s*(.+)$/im) || [])[1]?.trim() || '';
    const items = [];
    for (const line of text.split(/\r?\n/)) {
        let m = line.match(/^\s*ITEM\s*\d*\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const [title, desc, price, ...hook] = m[1].split('|').map(x => x.trim());
            if (title) items.push({ title: title.replace(/^[«"]|[»"]$/g, ''), desc: desc || '', price: price || '', hook: hook.join(' | '), en: '' });
            continue;
        }
        m = line.match(/^\s*EN\s*[:：—–-]\s*(.+)$/i);
        if (m && items.length) items[items.length - 1].en = m[1].trim();
    }
    items.slice(0, 3).forEach((it, i) => { it.rarity = rarities[i] || 'common'; });
    return { place, items: items.slice(0, 3) };
}
function gachaPicPrompt(a) {
    const pos = ['first', 'second', 'third'];
    return cleanForCommand(`${ITEM_STYLE}, ${a.options.length} separate vintage finds in a row, evenly spaced, each item small and centered in its own third of the image with wide empty space between items, nothing overlapping, plain light cream background, ` +
        a.options.map((x, i) => `${pos[i]} from the left: ${x.en || x.title}`).join('; ') + ', no people, no hands, no text, no captions');
}

async function openGachaLauncher() {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (!gachaOn(st)) return toastr.info('Гача выключена в этом чате — включи её в блокноте, вкладка «Сюжет»', '🎰 Гача');
    if (st.gacha.active?.status === 'choosing') return presentGacha();
    const left = gachaSpinsLeft(st);
    if (!left) return toastr.info(`На этом посте удачу уже испытывали ${GACHA_LIMIT} раза. Снова можно будет со следующим постом.`, '🎰 Гача');

    const el = $('<div class="nnb-pop"><h3>🎰 Испытать удачу</h3></div>');
    el.append($('<div class="nnb-pop-sub"></div>').text(`Прокруток на этом посте: ${left} из ${GACHA_LIMIT} · до гарантированной эпической: ${Math.max(1, GACHA_PITY - (st.gacha.pity || 0))}`));

    const hintInput = $('<input type="text" class="text_pole" style="margin: 8px 0 12px 0; width: 100%;" placeholder="Пожелание или тема (необязательно: «фильм на вечер», «профессия», «лавка старьёвщика»…)">');
    el.append(hintInput);

    const grid = $('<div class="nnb-cards nnb-cards-text" style="gap: 10px;"></div>');

    const itemCard = $('<div class="nnb-card-pick" tabindex="0" style="cursor:pointer;"><div class="nnb-card-body"><div class="nnb-card-kind">Категория 1 · В шкатулку</div><div class="nnb-card-title">🎁 Предметы и находки</div><div class="nnb-card-desc">Осязаемые вещицы, украшения, винтаж, подарки и диковинки — сохраняются в шкатулке.</div></div></div>');
    itemCard.on('click', async () => {
        const h = String(hintInput.val() || '').trim();
        closePopupOf(el);
        await runGachaRoll('items', h);
    });

    const choiceCard = $('<div class="nnb-card-pick" tabindex="0" style="cursor:pointer;"><div class="nnb-card-body"><div class="nnb-card-kind">Категория 2 · Для сюжета</div><div class="nnb-card-title">✨ Варианты и случаи</div><div class="nnb-card-desc">Куда пойти, книга или фильм на вечер, профессия, блюдо, случайное знакомство — вплетаются в сцену без шкатулки.</div></div></div>');
    choiceCard.on('click', async () => {
        const h = String(hintInput.val() || '').trim();
        closePopupOf(el);
        await runGachaRoll('choices', h);
    });

    grid.append(itemCard, choiceCard);
    el.append(grid);
    await openPopup(el);
}

async function runGachaRoll(mode = 'items', hint = '') {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (!gachaOn(st)) return toastr.info('Гача выключена в этом чате — включи её в блокноте, вкладка «Сюжет»', '🎰 Гача');
    if (st.gacha.active?.status === 'choosing') return presentGacha();
    if (!gachaSpinsLeft(st)) return toastr.info(`На этом посте удачу уже испытывали ${GACHA_LIMIT} раза. Снова можно будет со следующим постом.`, '🎰 Гача');
    const rarities = rollGacha(st.gacha);
    const statusText = mode === 'choices' ? '🎰 Модель придумывает варианты…' : '🎰 Крутим удачу…';
    const ok = await withBusy(statusText, async s2 => {
        const raw = await quietGenerate(gachaPrompt(s2, rarities, hint, mode));
        s2.lastRaw = String(raw ?? '');
        const { place, items } = parseGacha(raw, rarities);
        if (items.length < 2) {
            toastr.warning('Модель не выложила варианты по формату — загляни в «Последний ответ модели»', '🎰 Гача');
            return false;
        }
        s2.gacha.spins.push(ctx().chat.length);
        s2.gacha.total = (s2.gacha.total || 0) + 1;
        s2.gacha.stats = s2.gacha.stats || {};
        rarities.forEach(r => { s2.gacha.stats[r] = (s2.gacha.stats[r] || 0) + 1; });
        s2.gacha.active = { mode, place: place || (mode === 'choices' ? (hint || 'Случайный выбор') : 'Находки'), options: items, status: 'choosing', at: ctx().chat.length, date: s2.time.date || '' };
        return true;
    });
    if (ok) presentGacha();
}

async function startGacha(hintArg, modeArg) {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (st.gacha.active?.status === 'choosing') return presentGacha();
    if (modeArg === 'items' || modeArg === 'choices') {
        const hint = typeof hintArg === 'string' ? hintArg : '';
        return runGachaRoll(modeArg, hint);
    }
    return openGachaLauncher();
}
const presentGacha = () => {
    const a = store()?.gacha?.active;
    if (a?.mode === 'choices') return showGachaPopup();
    return openWhenReady('gacha', showGachaPopup);
};

async function showGachaPopup() {
    const st = store();
    const a = st?.gacha.active;
    if (!a || a.status !== 'choosing') return;
    const isChoices = a.mode === 'choices';
    const visual = !isChoices && wantImages();
    const el = $(`<div class="nnb-pop${visual ? ' nnb-pop-visual' : ''}"><h3></h3></div>`);
    el.find('h3').text(`${isChoices ? '✨' : '🎰'} ${a.place || (isChoices ? 'Варианты' : 'Находки')}`);
    el.append($('<div class="nnb-pop-sub"></div>').text(isChoices
        ? 'Выбери подходящий вариант — он сразу вплетётся в сюжет (в шкатулку не кладётся).'
        : 'Бери, что приглянулось, — можно несколько. Остальное уйдёт другим.'));
    const pick = async i => {
        if (a.options[i]?.taken) return;
        await chooseFind(i);
        el.find('.nnb-card-pick').eq(i).addClass('nnb-taken');
        leave.html('<i class="fa-solid fa-check"></i> Готово');
        if (playNowBtn) playNowBtn.show();
        if (a.options.every(o => o.taken)) closePopupOf(el);
    };
    const label = x => `${rarityOf(x.rarity).stars} ${rarityOf(x.rarity).name}${x.price ? ` · ${x.price}` : ''}`;
    if (visual) {
        el.append(visualPicker({ kind: 'gacha', items: a.options, title: x => x.title, label, onPick: pick, field: 'image', failField: 'imageFailed', a, cardClass: x => `nnb-rar nnb-rar-${x.rarity}${x.taken ? ' nnb-taken' : ''}` }));
    } else {
        const grid = $('<div class="nnb-cards nnb-cards-text"></div>');
        a.options.forEach((x, i) => {
            const card = $(`<div class="nnb-card-pick nnb-rar nnb-rar-${x.rarity}${x.taken ? ' nnb-taken' : ''}" tabindex="0"><div class="nnb-card-body"><div class="nnb-card-kind"></div><div class="nnb-card-title"></div><div class="nnb-card-desc"></div></div></div>`);
            card.find('.nnb-card-kind').text(label(x));
            card.find('.nnb-card-title').text(x.title);
            card.find('.nnb-card-desc').text(x.desc);
            card.on('click', () => pick(i));
            grid.append(card);
        });
        el.append(grid);
    }
    const anyTaken = () => a.options.some(o => o.taken);
    let playNowBtn = null;
    if (isChoices) {
        playNowBtn = $('<div class="menu_button nnb-btn-primary"></div>')
            .html('<i class="fa-solid fa-wand-magic-sparkles"></i> Отыграть сразу')
            .toggle(anyTaken())
            .on('click', async () => {
                closePopupOf(el);
                if (st.gacha.active === a) await finishGacha();
                const send = $('#send_but');
                if (send.length) send.trigger('click');
                else if (typeof ctx().generate === 'function') ctx().generate('normal');
            });
    }
    const leave = $('<div class="menu_button"></div>').html(anyTaken() ? '<i class="fa-solid fa-check"></i> Готово' : '<i class="fa-solid fa-person-walking-arrow-right"></i> Уйти ни с чем').on('click', async () => {
        closePopupOf(el);
        if (!anyTaken()) { st.gacha.active = null; await commit(); }
    });
    const row = $(`<div class="nnb-pop-row${visual ? ' nnb-pop-links' : ''}"></div>`);
    if (playNowBtn) row.append(playNowBtn);
    row.append(leave);
    el.append(row);
    await openPopup(el, visual);
    if (anyTaken() && st.gacha.active === a) await finishGacha();
}

async function finishGacha() {
    const st = store();
    const a = st?.gacha.active;
    if (!a) return;
    const left = a.options.filter(o => !o.taken).map(o => o.title);
    (Array.isArray(st.gacha.pending) ? st.gacha.pending : []).forEach(p => { if (p.spin === a.spin) p.others = left; });
    st.gacha.active = null;
    await commit();
}

async function chooseFind(i) {
    const st = store();
    const a = st?.gacha.active;
    const x = a?.options[i];
    if (!x) return;
    if (!a.spin) a.spin = Date.now();
    x.taken = true;
    const isChoices = a.mode === 'choices';
    const others = a.options.filter(o => !o.taken).map(o => o.title);
    const len = ctx().chat.length;

    if (isChoices) {
        if (!Array.isArray(st.gacha.choices)) st.gacha.choices = [];
        if (!st.gacha.nextChoiceId) st.gacha.nextChoiceId = 1;
        const choiceEntry = {
            id: st.gacha.nextChoiceId++,
            topic: a.place || 'Выбор',
            title: x.title,
            desc: x.desc,
            detail: x.price || '',
            hook: x.hook || '',
            rarity: x.rarity,
            pinned: false,
            date: a.date || st.time?.date || '',
            at: len,
        };
        st.gacha.choices.push(choiceEntry);
        if (st.gacha.choices.length > 30) st.gacha.choices.shift();
        const prev = Array.isArray(st.gacha.pending) ? st.gacha.pending.filter(p => p.at === len) : [];
        st.gacha.pending = [...prev, { mode: 'choices', title: x.title, desc: x.desc, hook: x.hook, rarity: x.rarity, place: a.place, price: x.price, others, at: len, spin: a.spin }];
        if (x.rarity === 'legendary' && st.direction.intrigues && x.hook) {
            st.intrigues.push({ id: st.nextIntrigueId++, tag: a.place || 'случай', text: `${x.title}: ${x.hook}`, clues: [], at: len });
        }
        await commit();
        const r = rarityOf(x.rarity);
        toastr.success(`${r.icon} ${escapeHtml(r.name)}: «${escapeHtml(x.title)}» — выбрано для сюжета!`, '✨ Варианты', { escapeHtml: false, timeOut: 7000 });
        return;
    }

    let crop = null;
    if (a.image) {
        try {
            const crops = await smartCrops(a.image, a.options.length, 'gacha', a.imageLayout);
            crop = crops[i] || null;
        } catch (e) { /* режем поровну */ }
        if (!crop) { const n = a.imageLayout?.cols || a.options.length; crop = { x: i / n, y: 0, w: 1 / n, h: 1 }; }
    }
    const where = [a.place, a.date ? formatDate(a.date) : ''].filter(Boolean).join(', ');
    st.wardrobe.box.push({
        id: st.wardrobe.nextItemId++, kind: findKind(x.title), title: x.title, desc: x.desc, origin: where ? `находка: ${where}` : 'находка',
        rarity: x.rarity, hook: x.hook, price: x.price, image: a.image || '', crop, at: len,
    });
    const prev = Array.isArray(st.gacha.pending) ? st.gacha.pending.filter(p => p.at === len) : [];
    st.gacha.pending = [...prev, { mode: 'items', title: x.title, desc: x.desc, hook: x.hook, rarity: x.rarity, place: a.place, price: x.price, others, at: len, spin: a.spin }];
    // легендарная находка открывает тайну
    if (x.rarity === 'legendary' && st.direction.intrigues && x.hook) {
        st.intrigues.push({ id: st.nextIntrigueId++, tag: 'находка', text: `${x.title}: ${x.hook}`, clues: [], at: len });
    }
    await commit();
    const r = rarityOf(x.rarity);
    toastr.success(`${r.icon} ${escapeHtml(r.name)}: «${escapeHtml(x.title)}» — в шкатулке.`, '🎰 Находки', { escapeHtml: false, timeOut: 7000 });
}

function gachaInjection(st) {
    if (!gachaOn(st)) return '';
    const names = storyNames();
    const out = [];

    const pinned = (st?.gacha?.choices || []).filter(c => c.pinned);
    if (pinned.length) {
        out.push(`[Закреплённые выборы ${names.user} (профессия, занятие, постоянные решения): ${pinned.map(c => `${c.topic ? `${c.topic}: ` : ''}«${c.title}»${c.detail ? ` (${c.detail})` : ''}${c.desc ? ` — ${c.desc}` : ''}`).join('; ')}. Учитывай это как постоянный канон истории.]`);
    }

    let list = st?.gacha?.pending;
    if (list) {
        if (!Array.isArray(list)) list = [list];
        const itemsList = list.filter(p => p.mode !== 'choices');
        const choicesList = list.filter(p => p.mode === 'choices');

        if (itemsList.length) {
            const oneItem = p => {
                const r = rarityOf(p.rarity);
                return `${p.price ? `купил(а) за ${p.price}` : 'взял(а)'}${p.place ? ` (${p.place})` : ''} ${r.name.toLowerCase().replace(/ая$/, 'ую')} находку — «${p.title}»${p.desc ? `: ${p.desc}` : ''}.${p.hook ? ` Как её обыграть: ${p.hook}.` : ''}${p.others?.length && !itemsList.some(q => q !== p && q.spin && q.spin === p.spin && itemsList.indexOf(q) > itemsList.indexOf(p)) ? ` Остальное (${p.others.join(', ')}) осталось на прилавке или досталось другим.` : ''}`;
            };
            const body = itemsList.length === 1 ? `${names.user} только что ${oneItem(itemsList[0])}` : `${names.user} только что сделал(а) несколько находок:\n${itemsList.map((p, i) => `${i + 1}) ${oneItem(p)}`).join('\n')}`;
            out.push(`[Находка: ${body}\nВ СЛЕДУЮЩЕМ ответе обязательно обыграй ${itemsList.length === 1 ? 'её' : 'их'}. Чем реже находка, тем заметнее её след в сюжете.]`);
        }

        if (choicesList.length) {
            const oneChoice = p => {
                const r = rarityOf(p.rarity);
                return `в теме «${p.place || 'выбор'}» выпал ${r.name.toLowerCase().replace(/ая$/, 'ый')} вариант — «${p.title}»${p.price ? ` (${p.price})` : ''}${p.desc ? `: ${p.desc}` : ''}.${p.hook ? ` Сюжетный крючок (обыграй естественно): ${p.hook}.` : ''}${p.others?.length && !choicesList.some(q => q !== p && q.spin && q.spin === p.spin && choicesList.indexOf(q) > choicesList.indexOf(p)) ? ` Другие варианты (${p.others.join(', ')}) не выбраны.` : ''}`;
            };
            const body = choicesList.length === 1 ? `Для ${names.user} только что ${oneChoice(choicesList[0])}` : `Для ${names.user} только что выпали следующие варианты:\n${choicesList.map((p, i) => `${i + 1}) ${oneChoice(p)}`).join('\n')}`;
            out.push(`[Выбор судьбы: ${body}\nВ СЛЕДУЮЩЕМ ответе обязательно естественно вплети и обыграй этот выбор в сцене (будь то книга/фильм на вечер, поход куда-то, работа/вакансия, знакомство или занятие). Чем выше редкость, тем ярче последствия для сюжета.]`);
        }
    }
    return out.join('\n\n');
}
function clearGachaPending() {
    const st = store();
    if (!st?.gacha?.pending) return;
    const list = Array.isArray(st.gacha.pending) ? st.gacha.pending : [st.gacha.pending];
    const last = ctx().chat?.[ctx().chat.length - 1];
    if (!last || last.is_user || ctx().chat.length <= Math.max(...list.map(p => p.at))) return;
    st.gacha.pending = null;
    ctx().saveMetadata();
}

function revealPrompt(st) {
    const a = st.wardrobe.active;
    const names = storyNames();
    const arcs = st.direction.arcs && st.arcs.length ? `\nТекущие арки:\n${formatArcs(st, true)}` : '';
    return [
        '[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — помощник автора.',
        `${names.user} выбрал(а) наряд «${a.look.title}» — ${a.look.desc}${a.occasion ? ` (для: ${a.occasion})` : ''}.`,
        a.look.effects ? `Задуманные последствия: ${a.look.effects}.` : '',
        a.accent ? `Штрих к образу: ${a.accent.title}${a.accent.effects ? ` (задумано: ${a.accent.effects})` : ''}.` : '',
        'Перечитай чат: как этот выбор на самом деле сыграл в сцене?' + arcs,
        'Ответь строками, без пояснений:',
        'RESULT: итог в 1–2 предложениях, с юмором и теплом — кто как отреагировал и чем этот образ запомнится',
        st.direction.arcs && st.arcs.length ? 'STIMULUS #A1: что изменилось — только если наряд действительно подтолкнул чью-то арку (иначе не пиши)' : '',
        st.direction.npcs && st.npcs.length ? 'NPCSTATE [Имя]: как изменилось отношение NPC — только если заметно изменилось (иначе не пиши)' : '',
        ']',
    ].filter(Boolean).join('\n');
}

async function revealOutfit(st) {
    const a = st.wardrobe.active;
    if (!a || a.status !== 'worn') return false;
    const raw = await quietGenerate(revealPrompt(st));
    let result = '';
    for (const line of answerLines(raw)) {
        const m = line.match(/^RESULT\s*[:：—–-]\s*(.+)$/i);
        if (m) { result = m[1].trim().replace(/\]$/, ''); break; }
    }
    const res = parseAndApply(raw.split('\n').filter(l => /STIMULUS|NPCSTATE/i.test(l)).join('\n'));
    const entry = {
        occasion: a.occasion, title: a.look.title, desc: a.look.desc, effects: a.look.effects,
        result: result || 'Сцена прошла — каждый запомнил этот образ по-своему.',
        others: (a.options || []).filter(o => o !== a.look).map(o => ({ title: o.title, effects: o.effects })),
        accent: a.accent ? { kind: a.accent.kind, title: a.accent.title, effects: a.accent.effects || '', origin: a.accent.origin || '' } : null,
        otherAccents: (a.accents || []).filter(x => !a.accent || x.title !== a.accent.title).map(x => ({ kind: x.kind, title: x.title, effects: x.effects })),
        image: a.image || '',
        date: st.time.date || '', stimuli: res.stimuli || 0,
    };
    if (a.accent?.kind === 'stone') {
        st.wardrobe.aura = { title: a.accent.title, desc: a.accent.desc || '', effects: a.accent.effects || '', until: st.time.date ? addDays(st.time.date, 3) : '', untilMsg: (ctx().chat?.length ?? 0) + 40 };
    }
    st.wardrobe.history.push(entry);
    if (st.wardrobe.history.length > 20) st.wardrobe.history.shift();
    st.wardrobe.active = null;
    if (st.direction.time && st.time.date) addEvent(st, st.time.date, `Образ «${entry.title}»${entry.occasion ? ` (${entry.occasion})` : ''}: ${entry.result}`);
    st.wardrobe.lastReveal = entry;
    return true;
}

async function runReveal() {
    const ok = await withBusy('🎭 Модель подводит итог образа…', st => revealOutfit(st));
    if (ok) showRevealPopup();
}

function closePopupOf(el) {
    let dlg = $(el).closest('dialog');
    if (!dlg.length) dlg = $(el).closest('.popup');
    const btn = dlg.find('.popup-button-ok').add(dlg.find('.popup-button-cancel')).first();
    if (btn.length) btn.trigger('click');
    else dlg[0]?.close?.();
}

async function openPopup(el, wide = false) {
    const c = ctx();
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) {
        await c.callGenericPopup(el[0], c.POPUP_TYPE.TEXT, '', { okButton: 'Закрыть', allowVerticalScrolling: true, wide, large: wide });
        return true;
    }
    return false;
}

async function showWardrobePopup() {
    const st = store();
    const a = st?.wardrobe.active;
    if (!a || a.status !== 'choosing') return;
    const selected = new Set();
    let wearIndex = 0;

    const visual = wantImages();
    const el = $(`<div class="nnb-pop${visual ? ' nnb-pop-visual' : ''}"><h3>👗 Выбери образы (можно несколько!)</h3></div>`);
    if (a.occasion) el.append($('<div class="nnb-pop-sub"></div>').text(`Повод: ${a.occasion}`));
    el.append('<div class="nnb-pop-sub">Отметь галочками все понравившиеся варианты — они сохранятся в твой 👗 Шкаф! Нажми «👕 Надеть сейчас» на одном из них или кнопку подтверждения внизу:</div>');

    const cards = $('<div class="nnb-looks"></div>');
    const confirmBtn = $('<div class="menu_button nnb-btn-primary"><i class="fa-solid fa-check"></i> Надеть и сохранить выбранные (1)</div>');
    const saveOnlyBtn = $('<div class="menu_button"><i class="fa-solid fa-box-archive"></i> Только сохранить в шкаф</div>');

    const updateSelectionUI = () => {
        cards.find('.nnb-look').each(function (idx) {
            const isSel = selected.has(idx);
            const isWear = wearIndex === idx;
            $(this).css('border-color', isWear ? 'var(--SmartThemeQuoteColor, #8b78c4)' : isSel ? 'rgba(139, 120, 196, 0.55)' : '');
            $(this).find('.nnb-look-cb').prop('checked', isSel);
            $(this).find('.nnb-wear-badge').text(isWear ? '👕 Надеть сейчас + в шкаф' : isSel ? '📥 Сохранить в шкаф' : 'Нажми, чтобы отметить');
        });
        const count = Math.max(1, selected.size);
        confirmBtn.html(`<i class="fa-solid fa-shirt"></i> Надеть «${escapeHtml(a.options[wearIndex]?.title || '')}» ${selected.size > 1 ? `и сохранить все (${selected.size}) в шкаф` : '(+ в шкаф)'}`);
    };

    selected.add(0);

    a.options.forEach((o, i) => {
        const card = $('<div class="nnb-look" tabindex="0"></div>');
        const topRow = $('<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"></div>');
        const titleLabel = $('<label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:600; flex:1;"><input type="checkbox" class="nnb-look-cb"><span class="nnb-look-title"></span></label>');
        titleLabel.find('.nnb-look-title').text(`${i + 1}. ${o.title}${o.category ? ` (${o.category})` : ''}`);
        const badge = $('<span class="nnb-wear-badge" style="font-size:0.8em; opacity:0.85; cursor:pointer; padding:2px 8px; border-radius:8px; border:1px solid var(--SmartThemeBorderColor);"></span>');
        badge.on('click', (e) => {
            e.stopPropagation();
            selected.add(i);
            wearIndex = i;
            updateSelectionUI();
        });
        topRow.append(titleLabel, badge);
        const descDiv = $('<div class="nnb-look-desc" style="margin-top:4px;"></div>').text(o.desc);
        card.append(topRow, descDiv);

        card.on('click', (e) => {
            if ($(e.target).is('input')) {
                if (titleLabel.find('input').prop('checked')) {
                    selected.add(i);
                    if (selected.size === 1) wearIndex = i;
                } else {
                    selected.delete(i);
                    if (wearIndex === i && selected.size) wearIndex = [...selected][0];
                }
                updateSelectionUI();
                return;
            }
            if (selected.has(i) && wearIndex !== i) {
                wearIndex = i;
            } else if (selected.has(i) && selected.size > 1) {
                selected.delete(i);
                if (wearIndex === i) wearIndex = [...selected][0];
            } else {
                selected.add(i);
                wearIndex = i;
            }
            updateSelectionUI();
        });
        cards.append(card);
    });

    if (visual) {
        const pickVisual = async i => {
            selected.add(i);
            wearIndex = i;
            closePopupOf(el);
            await chooseOutfit(wearIndex, null, [...selected]);
        };
        el.append(visualPicker({ kind: 'looks', items: a.options, title: o => o.title, onPick: pickVisual, field: 'image', failField: 'imageFailed', a }));
    }
    el.append(cards);
    updateSelectionUI();

    confirmBtn.on('click', async () => {
        closePopupOf(el);
        selected.add(wearIndex);
        await chooseOutfit(wearIndex, null, [...selected]);
    });
    saveOnlyBtn.on('click', async () => {
        const toSave = selected.size ? [...selected] : [wearIndex];
        toSave.forEach(idx => addLookToCloset(st, a.options[idx], normalizeClosetCat(a.options[idx].category || a.occasion)));
        st.wardrobe.active = null;
        await commit();
        closePopupOf(el);
        toastr.success(`Сохранено в шкаф: ${toSave.length} обр.`, '👗 Гардероб');
        await checkPendingTravel();
    });

    const actRow = $('<div class="nnb-pop-row" style="margin-top:10px; flex-wrap:wrap; gap:8px;"></div>').append(confirmBtn, saveOnlyBtn);
    el.append(actRow);

    const row = $(`<div class="nnb-pop-row${visual ? ' nnb-pop-links' : ''}" style="margin-top:8px;"></div>`);
    const closetBtn = $('<div class="menu_button"><i class="fa-solid fa-door-open"></i> Открыть шкаф</div>').on('click', () => {
        closePopupOf(el);
        openClosetPopup();
    });
    const own = $('<div class="menu_button"><i class="fa-solid fa-pen"></i> Свой вариант</div>');
    own.on('click', async () => {
        closePopupOf(el);
        const t = await askText('Опиши, что надето');
        if (t && t.trim()) await chooseOutfit(-1, t.trim());
    });
    const reroll = $('<div class="menu_button"><i class="fa-solid fa-dice"></i> Другие 5 образов</div>');
    reroll.on('click', () => { closePopupOf(el); rerollOutfits(); });
    row.append(closetBtn, own, reroll);
    if (st?.map?.pendingTravel) {
        const cancelTravel = $('<div class="menu_button"><i class="fa-solid fa-xmark"></i> Отмена поездки</div>');
        cancelTravel.on('click', async () => {
            closePopupOf(el);
            delete st.map.pendingTravel;
            st.wardrobe.active = null;
            await commit();
            toastr.info('Поездка отменена', '🗺 Карта');
        });
        row.append(cancelTravel);
    }
    el.append(row);
    if (!(await openPopup(el, visual))) toastr.info('Образы готовы — выбери в блокноте, вкладка «Гардероб»', '👗 Гардероб');
}

function revealCard(entry) {
    const el = $('<div class="nnb-pop"><h3>🎭 Чем обернулся образ</h3></div>');
    el.append($('<div class="nnb-look-title"></div>').text(`«${entry.title}»${entry.occasion ? ` — ${entry.occasion}` : ''}`));
    el.append($('<div class="nnb-pop-result"></div>').text(entry.result));
    if (entry.effects) el.append($('<div class="nnb-pop-sub"></div>').text('Задумано было: ' + entry.effects));
    if (entry.accent) el.append($('<div class="nnb-pop-sub"></div>').text(`${(ACCENT_KINDS[entry.accent.kind] || ACCENT_KINDS.accessory).icon} Штрих «${entry.accent.title}»${entry.accent.effects ? `: ${entry.accent.effects}` : ''}`));
    if (entry.others?.length || entry.otherAccents?.length) {
        const det = $('<details><summary>А что было бы, если…</summary></details>');
        (entry.others || []).forEach(o => det.append($('<div class="nnb-pop-other"></div>').text(`«${o.title}»: ${o.effects || 'реакции не записаны'}`)));
        (entry.otherAccents || []).forEach(o => det.append($('<div class="nnb-pop-other"></div>').text(`${(ACCENT_KINDS[o.kind] || ACCENT_KINDS.accessory).icon} «${o.title}»: ${o.effects || 'реакции не записаны'}`)));
        el.append(det);
    }
    return el;
}

async function showRevealPopup() {
    const st = store();
    const entry = st?.wardrobe.lastReveal;
    if (!entry) return;
    delete st.wardrobe.lastReveal;
    ctx().saveMetadata();
    if (!(await openPopup(revealCard(entry)))) toastr.success(escapeHtml(entry.result), '🎭 ' + escapeHtml(entry.title), { escapeHtml: false, timeOut: 12000 });
}

// ---------- 🗺 Карта: места, куда можно пойти ----------
// кавычки снимаем только парные — «Кафе «Сова»» должно остаться целым
function unquote(t) {
    t = String(t || '').trim();
    const m = t.match(/^[«"](.*)[»"]$/);
    return (m && !/[«»]/.test(m[1].replace(/«[^»]*»/g, '')) ? m[1] : t).trim();
}
function mapOn(st) {
    return !!st?.direction?.map;
}
function findPlace(st, title) {
    const t = unquote(title).toLowerCase();
    return t ? st.map.places.find(p => p.title.toLowerCase() === t) : null;
}
function addPlace(st, line, origin) {
    const parts = String(line || '').split('|').map(x => x.trim());
    const title = parts[0] || '';
    const desc = (parts[1] || '').replace(/\]$/, '').trim();
    const hooks = parts.slice(2).join(' | ').replace(/\]$/, '').trim();
    const t = unquote(String(title || '').replace(/\]$/, ''));
    if (!t || t.length > 80 || findPlace(st, t) || st.map.places.length >= 40) return null;
    const pl = { id: st.map.nextId++, title: t, desc, hooks, origin, visits: 0, at: ctx().chat?.length ?? 0 };
    st.map.places.push(pl);
    return pl;
}
function buildMapSection(st) {
    if (!mapOn(st)) return '';
    const known = st.map.places.map(p => p.title).join('; ');
    return `Карта мест. Уже на карте: ${known || '(пусто)'}.
MAP: название | что это за место | 2–3 конкретных крючка и зацепки этого места через точку с запятой (необычная деталь, колоритный завсегдатай, слух или микро-ситуация) — если в чате появилось новое место, куда можно сходить, и его ещё нет на карте.
HERE: название — если герои сейчас в месте с карты.`;
}
function mapSeedPrompt(st) {
    const names = storyNames();
    const t = st.time;
    const when = [t.date ? `${formatDate(t.date)}, ${season(t.date).name}` : '', placeLine(st)].filter(Boolean).join('; ');
    const known = st.map.places.map(p => p.title);
    return [
        '[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — помощник автора и рисуешь карту мест для этой истории.',
        when ? `Когда и где: ${when}.` : '',
        buildDirection(st),
        `Предложи ${known.length ? 4 : 5} мест поблизости, куда ${names.user} и другие персонажи могут пойти в этой истории. Места разные по настроению: уютные, людные, тайные, деловые, на природе. Учитывай город или мир, жанр, где живут и работают герои и что уже упоминалось в чате. Реальные места — только если они правда есть в этом городе, иначе придумай правдоподобные. В КАЖДОЕ место сразу заложи 2–3 конкретных крючка (точки интереса, необычные детали, местные слухи, странности или колоритных завсегдатаев), за которые интересно зацепиться в игре.`,
        known.length ? `Уже на карте (не повторяй): ${known.join(', ')}.` : '',
        'Формат, без пояснений:',
        'MAP: название | одно предложение, что это за место | крючок 1; крючок 2; крючок 3',
    ].filter(Boolean).join('\n') + ']';
}
async function seedMap() {
    const added = await withBusy('🗺 Модель набрасывает карту…', async st => {
        const raw = await quietGenerate(mapSeedPrompt(st));
        st.lastRaw = String(raw ?? '');
        const out = [];
        for (const line of String(raw || '').replace(/\*\*/g, '').split(/\r?\n/)) {
            const m = line.match(/^\s*MAP\s*[:：—–-]\s*(.+)$/i);
            if (m) { const pl = addPlace(st, m[1], 'start'); if (pl) out.push(pl); }
        }
        if (!out.length) toastr.warning('Модель не прислала места по формату — загляни в «Последний ответ модели»', '🗺 Карта');
        return out;
    });
    return added || [];
}

async function checkPendingTravel() {
    const st = store();
    if (!st?.map?.pendingTravel) return;
    const pt = st.map.pendingTravel;
    delete st.map.pendingTravel;
    await ctx().saveMetadata();
    const pl = (pt.placeId && st.map.places.find(p => p.id === pt.placeId)) || { id: pt.placeId, title: pt.title, desc: pt.desc, hooks: pt.hooks };
    await finalizeTravel(pl, { skipDays: pt.skipDays, companion: pt.companion });
}

async function finalizeTravel(pl, { skipDays = 0, companion = '' } = {}) {
    const st = store();
    if (!st) return;
    let moved = 0;
    if (skipDays > 0) {
        moved = skipDays;
        if (st.direction.time && st.time.date) {
            st.time.date = addDays(st.time.date, skipDays);
            if (settings().events) await holidayStep(st);
        }
    }
    if (pl.id) {
        pl.visits = (pl.visits || 0) + 1;
        st.map.current = pl.id;
    }
    await ctx().saveMetadata();
    updateInjection();
    renderPanel();

    const names = storyNames();
    const when = moved
        ? (moved === 1 ? ' Наступил следующий день.' : ` Прошло ${daysWord(moved)}.`) +
          (st.direction.time && st.time.date ? ` Сейчас ${weekday(st.time.date)}, ${formatDate(st.time.date)}.` : '')
        : '';
    const compText = companion && companion.trim() && !/^в одиночку$/i.test(companion.trim())
        ? ` Вместе с: ${companion.trim()}.`
        : ' В одиночку.';
    const hooksInfo = pl.hooks ? ` Известные особенности и зацепки этого места: ${String(pl.hooks).replace(/[.\s]+$/, '')}.` : '';
    const poiPrompt = livingWorldOn(st)
        ? ` Сразу при входе вплети в описание 2–3 конкретные точки интереса (живые крючки, за которые можно зацепиться): например, необычную деталь обстановки/объявление/забытый предмет, приметного человека со своим занятием и обрывок чужого разговора или микро-сценку поблизости.`
        : '';
    const text = `${FF_MARKER} игрок решил отправиться: «${pl.title}»${pl.desc ? ` — ${String(pl.desc).replace(/[.\s]+$/, '')}` : ''}.${hooksInfo}${compText}${when} Сверни текущую сцену одной-двумя фразами и начни новую уже там: дорога коротко (если она не важна), прибытие, какое это место сейчас, кто там и что происходит.${poiPrompt} ${pl.visits > 1 ? `${names.user} здесь уже бывал(а) — что-то знакомое, что-то изменилось.` : ''} Пиши как обычный ответ, не упоминай карту.]`;

    ctx().setExtensionPrompt(INJECT_FF_KEY, text, POS_IN_CHAT, 0, false, 0);
    ffPending = true;

    const timeLabel = moved ? (moved === 1 ? ' · завтра' : ` · +${daysWord(moved)}`) : '';
    const compLabel = companion && !/^в одиночку$/i.test(companion.trim()) ? ` · с ${escapeHtml(companion.trim())}` : '';
    toastr.info(`Отправляемся: ${escapeHtml(pl.title)}${timeLabel}${compLabel}`, '🗺 Карта', { escapeHtml: false, timeOut: 4500 });

    const send = $('#send_but');
    if (send.length) send.trigger('click');
    else if (typeof ctx().generate === 'function') ctx().generate('normal');
}

async function executeTravel(place, { skipDays = 0, companion = '', changeOutfit = false } = {}) {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (busy) return toastr.info('Модель уже занята — подожди пару секунд', 'Блокнот рассказчика');
    let pl = place;
    if (!pl?.title) return;

    if (changeOutfit && st.direction.wardrobe) {
        st.map.pendingTravel = {
            placeId: pl.id || null,
            title: pl.title,
            desc: pl.desc || '',
            hooks: pl.hooks || '',
            skipDays,
            companion: companion || '',
        };
        await ctx().saveMetadata();
        st.wardrobe.active = null;
        const occasion = `поездка: ${pl.title}`;
        const ok = await withBusy(`👗 Подбираем наряды для: ${pl.title}…`, s2 => generateOutfits(s2, occasion));
        if (ok) presentLooks();
        return;
    }
    await finalizeTravel(pl, { skipDays, companion });
}

async function openTravelModal(place, customText) {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (busy) return toastr.info('Модель уже занята — подожди пару секунд', 'Блокнот рассказчика');

    let pl = place;
    if (!pl && customText) pl = findPlace(st, customText) || addPlace(st, customText, 'user') || { title: customText.trim(), desc: '' };
    if (!pl?.title) return;

    const el = $('<div class="nnb-pop nnb-travel-pop"></div>');
    el.append($('<h3></h3>').text(`🧳 Сборы: ${pl.title}`));

    const metaParts = [];
    if (pl.desc) metaParts.push(pl.desc);
    if (pl.visits) metaParts.push(`бывали здесь: ${pl.visits}×`);
    if (metaParts.length) el.append($('<div class="nnb-pop-sub"></div>').text(metaParts.join(' · ')));

    // 1. Когда отправляемся
    el.append('<div class="nnb-travel-sec-title">📅 Когда отправляемся?</div>');
    const timeChips = $('<div class="nnb-chips-row nnb-travel-chips"></div>');
    let skipDays = 0;

    const timeOptions = [
        { label: '☀️ Сегодня', days: 0 },
        { label: '🌅 Завтра', days: 1 },
        { label: '📅 Через 2 дня', days: 2 },
        { label: '⏳ Через неделю', days: 7 },
    ];

    const dateHint = $('<div class="nnb-pop-sub nnb-travel-date-hint"></div>');
    const updateDateHint = () => {
        if (!st.direction.time || !st.time.date) {
            dateHint.text(skipDays === 0 ? 'Текущий день истории' : skipDays === 1 ? 'Сцена начнётся на следующий день' : `Сцена начнётся через ${daysWord(skipDays)}`);
            return;
        }
        const targetDate = addDays(st.time.date, skipDays);
        dateHint.text(`Дата: ${weekday(targetDate)}, ${formatDate(targetDate)}${skipDays > 0 ? ` (+${daysWord(skipDays)})` : ' (сегодня)'}`);
    };

    const customDaysChip = $('<div class="nnb-travel-chip" tabindex="0">✏️ Свой срок…</div>');
    const customDaysInput = $('<input type="number" min="1" max="365" class="text_pole nnb-travel-custom-days" style="display:none; width:75px; margin:0 4px;" placeholder="дней">');

    timeOptions.forEach(opt => {
        const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(opt.label);
        if (opt.days === skipDays) chip.addClass('active');
        chip.on('click', () => {
            skipDays = opt.days;
            customDaysInput.val('').hide();
            timeChips.find('.nnb-travel-chip').removeClass('active');
            chip.addClass('active');
            updateDateHint();
        });
        timeChips.append(chip);
    });

    customDaysChip.on('click', () => {
        timeChips.find('.nnb-travel-chip').removeClass('active');
        customDaysChip.addClass('active');
        customDaysInput.show().trigger('focus');
        skipDays = Math.max(1, Number(customDaysInput.val()) || 1);
        updateDateHint();
    });
    customDaysInput.on('input change', () => {
        skipDays = Math.max(1, Number(customDaysInput.val()) || 1);
        updateDateHint();
    });
    timeChips.append(customDaysChip, customDaysInput);
    el.append(timeChips, dateHint);
    updateDateHint();

    // 2. Что надеть
    let changeOutfit = false;
    if (st.direction.wardrobe) {
        el.append('<div class="nnb-travel-sec-title">👗 Что надеть?</div>');
        const wardChips = $('<div class="nnb-chips-row nnb-travel-chips"></div>');
        const wardHint = $('<div class="nnb-pop-sub nnb-travel-ward-hint"></div>');

        const curOutfit = st.wardrobe?.active?.status === 'worn' ? st.wardrobe.active.look.title : '';
        const keepChip = $('<div class="nnb-travel-chip active" tabindex="0">🧥 Пойти как есть</div>');
        const changeChip = $('<div class="nnb-travel-chip" tabindex="0">✨ Подобрать наряд под место</div>');

        const updateWardHint = () => {
            if (!changeOutfit) {
                wardHint.text(curOutfit ? `Сейчас надето: «${curOutfit}»` : 'Без смены наряда');
            } else {
                wardHint.text(`Перед отправлением откроется выбор образов для «${pl.title}»`);
            }
        };

        keepChip.on('click', () => {
            changeOutfit = false;
            keepChip.addClass('active');
            changeChip.removeClass('active');
            updateWardHint();
        });
        changeChip.on('click', () => {
            changeOutfit = true;
            changeChip.addClass('active');
            keepChip.removeClass('active');
            updateWardHint();
        });

        wardChips.append(keepChip, changeChip);
        el.append(wardChips, wardHint);
        updateWardHint();
    }

    // 3. С кем идём
    el.append('<div class="nnb-travel-sec-title">👥 Кто с нами?</div>');
    const compChips = $('<div class="nnb-chips-row nnb-travel-chips"></div>');
    let companion = '';

    const soloChip = $('<div class="nnb-travel-chip active" tabindex="0">🚶 В одиночку</div>');
    compChips.append(soloChip);

    const names = storyNames();
    const candidateCompanions = [];
    (st.npcs || []).filter(n => n.favorite).forEach(n => {
        if (n.name && !candidateCompanions.includes(n.name)) candidateCompanions.push(n.name);
    });
    if (!st.worldProfile?.freeWorld) {
        (names.chars || []).forEach(cName => {
            if (cName && !candidateCompanions.includes(cName)) candidateCompanions.push(cName);
        });
    }
    (st.npcs || []).slice(0, 8).forEach(n => {
        if (n.name && !candidateCompanions.includes(n.name)) candidateCompanions.push(n.name);
    });

    candidateCompanions.forEach(cName => {
        const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(`С ${cName}`);
        chip.on('click', () => {
            companion = cName;
            compChips.find('.nnb-travel-chip').removeClass('active');
            chip.addClass('active');
            compInput.val(cName);
        });
        compChips.append(chip);
    });

    const compInput = $('<input type="text" class="text_pole nnb-travel-comp-input" placeholder="Или напиши имя/компанию…">');
    soloChip.on('click', () => {
        companion = '';
        compChips.find('.nnb-travel-chip').removeClass('active');
        soloChip.addClass('active');
        compInput.val('');
    });
    compInput.on('input', () => {
        companion = compInput.val().trim();
        compChips.find('.nnb-travel-chip').removeClass('active');
        if (!companion) soloChip.addClass('active');
    });

    el.append(compChips, compInput);

    // 4. Кнопки
    const actRow = $('<div class="nnb-pop-row nnb-travel-actions"></div>');
    const goBtn = $('<div class="menu_button nnb-btn-primary" tabindex="0"><i class="fa-solid fa-person-walking"></i> Отправиться</div>');
    const cancelBtn = $('<div class="menu_button" tabindex="0"><i class="fa-solid fa-xmark"></i> Отмена</div>');

    goBtn.on('click', async () => {
        closePopupOf(el);
        await executeTravel(pl, { skipDays, companion, changeOutfit });
    });
    cancelBtn.on('click', () => closePopupOf(el));

    actRow.append(goBtn, cancelBtn);
    el.append(actRow);

    await openPopup(el);
}

async function goToPlace(place, customText) {
    return openTravelModal(place, customText);
}

function placeRow(st, pl, onGo, tools) {
    const row = $('<div class="nnb-note nnb-place"><div class="nnb-place-main"><div class="nnb-npc-text"></div><div class="nnb-npc-status"></div><div class="nnb-npc-status nnb-place-hooks"></div></div></div>');
    const here = st.map.current === pl.id;
    if (here) row.addClass('nnb-place-here');
    row.find('.nnb-npc-text').text(`${here ? '📍' : pl.origin === 'story' ? '✨' : pl.origin === 'user' ? '✏️' : '•'} ${pl.title}`);
    const meta = [pl.desc, here ? 'вы здесь' : pl.visits ? `уже бывали: ${pl.visits}×` : ''].filter(Boolean).join(' · ');
    if (meta) row.find('.nnb-npc-status').first().text(meta); else row.find('.nnb-npc-status').first().remove();
    if (pl.hooks) row.find('.nnb-place-hooks').text(`🔍 Зацепка: ${pl.hooks}`); else row.find('.nnb-place-hooks').remove();
    row.find('.nnb-place-main').css('cursor', 'pointer').on('click', () => onGo(pl));
    if (tools) {
        const act = $('<div class="nnb-actions"><i class="fa-solid fa-pen" title="Изменить"></i><i class="fa-solid fa-trash" title="Убрать с карты"></i></div>');
        act.find('.fa-pen').on('click', async () => {
            const t = await askText('Название места', pl.title);
            if (t === null) return;
            const d = await askText('Что это за место? (описание)', pl.desc);
            if (d === null) return;
            const h = await askText('История, странность или точка интереса в этом месте (можно оставить пустым)', pl.hooks || '');
            if (h === null) return;
            if (t.trim()) pl.title = t.trim();
            pl.desc = d.trim();
            pl.hooks = h.trim();
            await commit();
        });
        act.find('.fa-trash').on('click', async () => { st.map.places = st.map.places.filter(x => x !== pl); if (st.map.current === pl.id) st.map.current = null; await commit(); });
        row.append(act);
    }
    return row;
}
function sortedPlaces(st) {
    // сначала свежие находки сюжета, потом остальное по порядку
    return [...st.map.places].sort((a, b) => (b.origin === 'story' && !b.visits) - (a.origin === 'story' && !a.visits) || a.id - b.id);
}

async function showMapPopup() {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (!mapOn(st)) return toastr.info('Карта выключена в этом чате — включи её в блокноте, вкладка «Сюжет»', '🗺 Карта');
    if (!st.map.places.length) {
        const added = await seedMap();
        if (!added.length) return;
    }
    const el = $('<div class="nnb-pop nnb-map-pop"><h3>🗺 Куда пойти?</h3></div>');
    const go = async pl => { closePopupOf(el); await goToPlace(pl); };
    const list = $('<div class="nnb-places"></div>');
    sortedPlaces(st).forEach(pl => list.append(placeRow(st, pl, go, false)));
    el.append(list);
    const custom = $('<div class="nnb-pop-row nnb-map-custom"><input type="text" class="text_pole" placeholder="Свой вариант: куда идём?"><div class="menu_button"><i class="fa-solid fa-person-walking"></i> Пойти</div></div>');
    const doCustom = async () => { const t = String(custom.find('input').val() || '').trim(); if (!t) return; closePopupOf(el); await goToPlace(null, t); };
    custom.find('.menu_button').on('click', doCustom);
    custom.find('input').on('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doCustom(); } });
    el.append(custom);
    el.append($('<div class="nnb-pop-row nnb-pop-links"></div>').append($('<div class="menu_button"><i class="fa-solid fa-book-open"></i> Карта в блокноте</div>').on('click', () => { closePopupOf(el); openBook('map'); })));
    await openPopup(el);
}

function renderMap(st) {
    const root = $('#nnb_map_box').empty();
    if (!mapOn(st)) return;
    const m = st.map;
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`🗺 Карта (${m.places.length})`);
    const cur = m.places.find(p => p.id === m.current);
    if (cur) det.append($('<div class="nnb-npc-status"></div>').text(`📍 Сейчас: ${cur.title}`));
    if (!m.places.length) det.append('<div class="nnb-empty">Карта пока пустая. Набросай её — модель предложит несколько мест вокруг, а дальше карта будет расти сама, когда в сюжете появятся новые места.</div>');
    sortedPlaces(st).forEach(pl => det.append(placeRow(st, pl, pl2 => { closeBook(); goToPlace(pl2); }, true)));
    const btns = $('<div class="nnb-buttons"></div>');
    btns.append($('<div class="menu_button"><i class="fa-solid fa-map"></i> Куда пойти?</div>').on('click', () => { closeBook(); showMapPopup(); }));
    btns.append($(`<div class="menu_button"><i class="fa-solid fa-wand-magic-sparkles"></i> ${m.places.length ? 'Ещё мест' : 'Набросать карту'}</div>`).on('click', () => seedMap()));
    btns.append($('<div class="menu_button"><i class="fa-solid fa-plus"></i> Добавить место</div>').on('click', async () => {
        const t = await askText('Название места');
        if (!t || !t.trim()) return;
        const d = await askText('Что это за место? Можно оставить пустым');
        if (d === null) return;
        const h = await askText('Маленькая история, странность или зацепка этого места (можно оставить пустым)');
        if (h === null) return;
        addPlace(st, `${t.trim()} | ${d.trim()}${h.trim() ? ` | ${h.trim()}` : ''}`, 'user');
        await commit();
    }));
    det.append(btns);
    root.append(det);
}

// 🎁 Шкатулка и 🎰 находки — своя вкладка
function boxOn(st) {
    return accentsOn(st) || gachaOn(st);
}
function findThumb(x, size) {
    const el = $('<div class="nnb-card-img nnb-find-thumb"></div>').css({ width: size, height: size });
    applyCrop(el, x.image, x.crop || { x: 0, y: 0, w: 1, h: 1 }, 1.5);
    return el;
}

// ---------- Активные предметы из шкатулки ----------
async function toggleEquipped(x) {
    const st = store();
    if (!st) return;
    if (!Array.isArray(st.wardrobe.equipped)) st.wardrobe.equipped = [];
    const idx = st.wardrobe.equipped.indexOf(x.id);
    if (idx >= 0) {
        st.wardrobe.equipped.splice(idx, 1);
        toastr.info(`«${escapeHtml(x.title)}» убран в шкатулку`, '🎒 Предмет', { escapeHtml: false });
    } else {
        if (st.wardrobe.equipped.length >= 3) st.wardrobe.equipped.shift();
        st.wardrobe.equipped.push(x.id);
        toastr.success(`«${escapeHtml(x.title)}» взят с собой (наготове)`, '🎒 Активный предмет', { escapeHtml: false });
    }
    await commit();
}

async function applyItemInScene(x, customAction) {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (busy) return toastr.info('Модель уже занята — подожди пару секунд', 'Блокнот рассказчика');
    const names = storyNames();
    const place = st.map?.places?.find(p => p.id === st.map?.current);
    const where = place ? ` в месте «${place.title}»` : '';
    const act = customAction ? ` Действие: ${customAction}.` : '';
    const text = `${FF_MARKER} ${names.user} достаёт и применяет предмет: «${x.title}»${x.desc ? ` — ${x.desc}` : ''}${where}.${act} Опиши реакцию персонажей и последствия этого действия. Пиши как обычный ответ, не упоминай команды.]`;
    ctx().setExtensionPrompt(INJECT_FF_KEY, text, POS_IN_CHAT, 0, false, 0);
    ffPending = true;
    toastr.info(`Применяем: ${escapeHtml(x.title)}`, '🪄 Активный предмет', { escapeHtml: false, timeOut: 4000 });
    const send = $('#send_but');
    if (send.length) send.trigger('click');
    else if (typeof ctx().generate === 'function') ctx().generate('normal');
}

async function giftItemToNpc(x, npcName) {
    const st = store();
    if (!st) return;
    x.giftedTo = npcName.trim();
    x.giftedAt = ctx().chat.length;
    st.wardrobe.equipped = (st.wardrobe.equipped || []).filter(id => id !== x.id);
    await commit();
    const names = storyNames();
    const text = `${FF_MARKER} ${names.user} дарит «${x.title}» персонажу ${x.giftedTo}. Это подарок (${x.origin || x.desc || 'особенная вещь'}). Опиши реакцию ${x.giftedTo} в характере и как этот жест отразится на их отношениях.]`;
    ctx().setExtensionPrompt(INJECT_FF_KEY, text, POS_IN_CHAT, 0, false, 0);
    ffPending = true;
    toastr.success(`🎁 «${escapeHtml(x.title)}» теперь у ${escapeHtml(x.giftedTo)}`, 'Подарок', { escapeHtml: false, timeOut: 5000 });
    const send = $('#send_but');
    if (send.length) send.trigger('click');
    else if (typeof ctx().generate === 'function') ctx().generate('normal');
}

async function promptGiftItem(x) {
    const st = store();
    if (!st) return;
    const npcs = (st.npcs || []).map(n => n.name);
    let target = '';
    if (npcs.length) {
        target = await askText(`Кому подарить «${x.title}»? Персонажи: ${npcs.join(', ')}`);
    } else {
        target = await askText(`Кому подарить «${x.title}»? Назови имя персонажа`);
    }
    if (!target || !target.trim()) return;
    await giftItemToNpc(x, target.trim());
}

function showFind(x) {
    const st = store();
    const r = x.rarity ? rarityOf(x.rarity) : null;
    const isEquipped = (st?.wardrobe?.equipped || []).includes(x.id);
    const el = $('<div class="nnb-pop"></div>');
    if (x.image) el.append(findThumb(x, '240px').addClass('nnb-find-big' + (r ? ` nnb-rar nnb-rar-${x.rarity}` : '')));
    el.append($('<h3></h3>').text(`${(ACCENT_KINDS[x.kind] || ACCENT_KINDS.find).icon} ${x.title}`));
    let sub = [r ? `${r.stars} ${r.name}` : '', x.price || '', x.giftedTo ? `🎁 у ${x.giftedTo}` : isEquipped ? '🎒 с собой' : ''].filter(Boolean).join(' · ');
    if (sub) el.append($('<div class="nnb-pop-sub"></div>').text(sub));
    if (x.desc) el.append($('<div class="nnb-look-desc"></div>').text(x.desc));
    if (x.origin) el.append($('<div class="nnb-pop-sub"></div>').text(x.origin));

    const acts = $('<div class="nnb-pop-row nnb-item-actions"></div>');
    if (x.giftedTo) {
        const reclaimBtn = $(`<div class="menu_button"><i class="fa-solid fa-rotate-left"></i> Вернуть в шкатулку</div>`);
        reclaimBtn.on('click', async () => {
            closePopupOf(el);
            delete x.giftedTo;
            delete x.giftedAt;
            await commit();
            toastr.info(`«${escapeHtml(x.title)}» возвращён в шкатулку`, 'Шкатулка', { escapeHtml: false });
        });
        acts.append(reclaimBtn);
    } else {
        const eqBtn = $(`<div class="menu_button"><i class="fa-solid fa-briefcase"></i> ${isEquipped ? 'Убрать в шкатулку' : 'Взять с собой'}</div>`);
        eqBtn.on('click', async () => {
            closePopupOf(el);
            await toggleEquipped(x);
        });
        acts.append(eqBtn);

        const giftBtn = $('<div class="menu_button"><i class="fa-solid fa-gift"></i> Подарить…</div>');
        giftBtn.on('click', async () => {
            closePopupOf(el);
            await promptGiftItem(x);
        });
        acts.append(giftBtn);
    }
    const applyBtn = $('<div class="menu_button"><i class="fa-solid fa-wand-magic-sparkles"></i> Применить в сцене</div>');
    applyBtn.on('click', async () => {
        closePopupOf(el);
        const act = await askText(`Как применить «${x.title}» в сцене? Оставь пустым — модель решит сама.`);
        if (act === null) return;
        await applyItemInScene(x, act.trim());
    });
    acts.append(applyBtn);

    el.append(acts);
    openPopup(el);
}
function renderBox(st) {
    const root = $('#nnb_box_box').empty();
    if (!boxOn(st)) return;
    const w = st.wardrobe;
    if (gachaOn(st)) {
        const g = st.gacha;
        const det = $('<details open class="nnb-section"><summary>🎰 Гача: находки и варианты</summary></details>');
        if (g.active?.status === 'choosing') {
            const isChoices = g.active.mode === 'choices';
            const card = $('<div class="nnb-note nnb-event"><div class="nnb-event-title"></div><div class="nnb-meta"></div></div>');
            card.find('.nnb-event-title').text(`${isChoices ? '✨' : '🎁'} ${g.active.place || (isChoices ? 'Варианты' : 'Прилавок')}`);
            card.find('.nnb-meta').text(isChoices ? 'Варианты ждут выбора' : 'Находки ждут выбора');
            card.append($('<div class="menu_button"><i class="fa-solid fa-eye"></i> Посмотреть</div>').on('click', presentGacha));
            card.append($('<div class="menu_button"><i class="fa-solid fa-xmark"></i> Уйти ни с чем</div>').on('click', async () => { if (g.active.options.some(o => o.taken)) await finishGacha(); else { g.active = null; await commit(); } }));
            det.append(card);
        } else {
            const left = gachaSpinsLeft(st);
            det.append($('<div class="nnb-npc-status"></div>').text(`Прокруток на этом посте: ${left} из ${GACHA_LIMIT}${left ? '' : ' (снова — со следующим постом)'} · до гарантированной эпической: ${Math.max(1, GACHA_PITY - (g.pity || 0))}`));
            const btns = $('<div class="nnb-buttons" style="display:flex; gap:6px; flex-wrap:wrap; margin:6px 0;"></div>');
            btns.append($('<div class="menu_button" style="flex:1;"><i class="fa-solid fa-gift"></i> Предметы (в шкатулку)</div>').on('click', async () => {
                const h = await askText('Где ищем или что за предмет? Оставь пустым — модель сама подстроится под сцену.');
                if (h === null) return;
                await runGachaRoll('items', h.trim());
            }));
            btns.append($('<div class="menu_button" style="flex:1;"><i class="fa-solid fa-wand-magic-sparkles"></i> Варианты (для сюжета)</div>').on('click', async () => {
                const h = await askText('На какую тему крутим варианты? (например: «фильм на вечер», «профессия», «куда пойти», «знакомство» — или оставь пустым, модель выберет сама по сцене)');
                if (h === null) return;
                await runGachaRoll('choices', h.trim());
            }));
            det.append(btns);
            const stt = g.stats || {};
            const seen = RARITIES.reduce((a2, r) => a2 + (stt[r.id] || 0), 0);
            if (seen) det.append($('<div class="nnb-npc-status"></div>').text(`Выпадало за ${g.total || 0} прокр. (${seen}): ` + RARITIES.map(r => `${r.icon} ${stt[r.id] || 0}`).join(' · ') + ' — шансы: ' + RARITIES.map(r => `${r.w}%`).join(' / ')));
        }
        if (Array.isArray(g.choices) && g.choices.length) {
            det.append($('<div class="nnb-subhead" style="margin-top:8px;"></div>').text(`✨ Выпавшие варианты сюжета (${g.choices.length})`));
            [...g.choices].reverse().forEach(c => {
                const r = c.rarity ? rarityOf(c.rarity) : RARITIES[0];
                const row = $(`<div class="nnb-note nnb-rar nnb-rar-${c.rarity || 'common'}"><div class="nnb-meta"></div><div class="nnb-npc-text"></div><div class="nnb-npc-status"></div><div class="nnb-actions"></div></div>`);
                row.find('.nnb-meta').text(`${r.stars} ${r.name} · ${c.topic || 'Вариант'}${c.detail ? ` · ${c.detail}` : ''}${c.pinned ? ' · 📌 закреплено' : ''}`);
                row.find('.nnb-npc-text').text(c.title);
                if (c.desc) row.find('.nnb-npc-status').text(c.desc); else row.find('.nnb-npc-status').remove();
                const acts = row.find('.nnb-actions');
                const pinBtn = $(`<i class="fa-solid fa-thumbtack" title="${c.pinned ? 'Открепить (не держать постоянно в памяти)' : 'Закрепить в памяти (для профессии, хобби и постоянных статусов)'}" style="${c.pinned ? 'color: var(--SmartThemeQuoteColor, #8b78c4); opacity: 1;' : 'opacity: 0.55;'}"></i>`).on('click', async () => {
                    c.pinned = !c.pinned;
                    await commit();
                    toastr.info(c.pinned ? `«${c.title}» закреплено как постоянный факт` : `«${c.title}» откреплено`, '✨ Варианты');
                });
                const playBtn = $('<i class="fa-solid fa-wand-magic-sparkles" title="Отыграть в следующей сцене"></i>').on('click', async () => {
                    const names = storyNames();
                    const text = `${FF_MARKER} ${names.user} решает воплотить выбранный вариант (${c.topic || 'выбор'}): «${c.title}»${c.detail ? ` (${c.detail})` : ''}${c.desc ? ` — ${c.desc}` : ''}.${c.hook ? ` Сюжетный крючок: ${c.hook}.` : ''} Естественно вплети это в сцену. Пиши как обычный ответ.]`;
                    ctx().setExtensionPrompt(INJECT_FF_KEY, text, POS_IN_CHAT, 0, false, 0);
                    ffPending = true;
                    closeBook();
                    toastr.info(`Отыгрываем: «${escapeHtml(c.title)}»`, '✨ Варианты', { escapeHtml: false });
                    const send = $('#send_but');
                    if (send.length) send.trigger('click');
                    else if (typeof ctx().generate === 'function') ctx().generate('normal');
                });
                const mapBtn = $('<i class="fa-solid fa-map-location-dot" title="Добавить как место на карту"></i>').on('click', async () => {
                    const pl = addPlace(st, `${c.title} | ${c.desc || c.detail || ''}`, 'user');
                    if (pl) {
                        await commit();
                        toastr.success(`Место «${escapeHtml(pl.title)}» добавлено на карту!`, '🗺 Карта', { escapeHtml: false });
                    } else {
                        toastr.info('Это место уже есть на карте', '🗺 Карта');
                    }
                });
                const delBtn = $('<i class="fa-solid fa-trash" title="Удалить"></i>').on('click', async () => {
                    g.choices = g.choices.filter(x => x !== c);
                    await commit();
                });
                acts.append(pinBtn, playBtn, mapBtn, delBtn);
                det.append(row);
            });
        }
        root.append(det);
    }
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`🎁 Шкатулка (${w.box.length})`);
    if (!w.box.length) det.append('<div class="nnb-empty">Здесь будут находки, духи, косметика и украшения из сюжета: подарки, покупки, трофеи. Модель замечает их при размышлении, или добавь сама.</div>');
    [...w.box].reverse().forEach(x => {
        const row = $('<div class="nnb-note nnb-box-item"><div class="nnb-box-main"><div class="nnb-npc-text"></div><div class="nnb-npc-status"></div></div><div class="nnb-actions"><i class="fa-solid fa-pen" title="Изменить"></i><i class="fa-solid fa-trash" title="Убрать из шкатулки"></i></div></div>');
        if (x.rarity) row.addClass(`nnb-rar nnb-rar-${x.rarity}`);
        const r = x.rarity ? rarityOf(x.rarity) : null;
        row.find('.nnb-npc-text').text(`${(ACCENT_KINDS[x.kind] || ACCENT_KINDS.find).icon} ${x.title}${r ? ` ${r.stars}` : ''}`);
        if (x.origin || x.desc) row.find('.nnb-npc-status').text([x.desc, x.origin].filter(Boolean).join(' · ')); else row.find('.nnb-npc-status').remove();
        if (x.image) row.prepend(findThumb(x, '64px'));
        row.find('.nnb-box-main, .nnb-find-thumb').css('cursor', 'pointer').on('click', () => showFind(x));
        row.find('.fa-pen').on('click', async () => {
            const t = await askText('Что это за вещь?', x.title);
            if (t === null) return;
            const o = await askText('Откуда она? Например «подарок Кайлара на годовщину»', x.origin);
            if (o === null) return;
            if (t.trim()) { x.title = t.trim(); x.kind = x.rarity ? findKind(t) : accentKind(t); }
            x.origin = o.trim();
            await commit();
        });
        if ((st.wardrobe.equipped || []).includes(x.id)) {
            row.find('.nnb-meta, .nnb-npc-status').prepend('<span class="nnb-item-badge nnb-badge-equipped">🎒 с собой</span> ');
        } else if (x.giftedTo) {
            row.find('.nnb-meta, .nnb-npc-status').prepend(`<span class="nnb-item-badge nnb-badge-gifted">🎁 у ${escapeHtml(x.giftedTo)}</span> `);
        }
        const quickAct = $('<i class="fa-solid fa-wand-magic-sparkles" title="Применить в сцене"></i>').on('click', async (e) => {
            e.stopPropagation();
            const act = await askText(`Как применить «${x.title}» в сцене? Оставь пустым — модель решит сама.`);
            if (act === null) return;
            await applyItemInScene(x, act.trim());
        });
        const quickGift = $('<i class="fa-solid fa-gift" title="Подарить персонажу"></i>').on('click', async (e) => {
            e.stopPropagation();
            await promptGiftItem(x);
        });
        row.find('.nnb-actions').prepend(quickGift).prepend(quickAct);
        row.find('.fa-trash').on('click', async () => {
            w.box = w.box.filter(y => y !== x);
            w.equipped = (w.equipped || []).filter(id => id !== x.id);
            await commit();
        });
        det.append(row);
    });
    det.append($('<div class="menu_button"><i class="fa-solid fa-gem"></i> Добавить вещь</div>').on('click', async () => {
        const t = await askText('Что это? Например «духи с бергамотом», «кулон с аметистом», «старое письмо»');
        if (!t || !t.trim()) return;
        const o = await askText('Откуда она? Можно оставить пустым');
        if (o === null) return;
        w.box.push({ id: w.nextItemId++, kind: findKind(t), title: t.trim(), desc: '', origin: o.trim(), at: ctx().chat.length });
        await commit();
    }));
    root.append(det);
}

function renderWardrobe(st) {
    const root = $('#nnb_wardrobe_box').empty();
    if (!st.direction.wardrobe) return;
    const w = st.wardrobe;
    const det = $('<details open class="nnb-section"><summary>👗 Гардероб</summary></details>');
    root.append(det);
    const a = w.active;
    if (a?.status === 'choosing') {
        const box = $('<div class="nnb-note nnb-event"><div class="nnb-event-title">Образы ждут выбора</div><div class="nnb-meta"></div></div>');
        box.find('.nnb-meta').text(a.occasion || 'для ближайшей сцены');
        const open = $('<div class="menu_button"><i class="fa-solid fa-shirt"></i> Выбрать образ</div>').on('click', presentLooks);
        const cancel = $('<div class="menu_button"><i class="fa-solid fa-xmark"></i> Не нужно</div>').on('click', async () => {
            w.active = null;
            if (st.map?.pendingTravel) delete st.map.pendingTravel;
            await commit();
        });
        box.append(open, cancel);
        det.append(box);
    } else if (a?.status === 'worn') {
        const box = $('<div class="nnb-note nnb-event"><div class="nnb-event-title"></div><div class="nnb-npc-text nnb-text"></div><div class="nnb-meta">Последствия раскроются, когда сцена пройдёт: модель отметит это при размышлении, или нажми кнопку.</div></div>');
        box.find('.nnb-event-title').text(`Сейчас: «${a.look.title}»${a.occasion ? ` — ${a.occasion}` : ''}`);
        box.find('.nnb-npc-text').text(a.look.desc + (a.accent ? `\n${(ACCENT_KINDS[a.accent.kind] || ACCENT_KINDS.accessory).icon} ${a.accent.title}` : ''));
        if (accentsOn(st) && !a.accent) box.append($('<div class="menu_button"><i class="fa-solid fa-wand-magic-sparkles"></i> Добавить штрих</div>').on('click', presentAccents));
        const rev = $('<div class="menu_button"><i class="fa-solid fa-masks-theater"></i> Сцена прошла — чем это обернулось?</div>').on('click', runReveal);
        box.append(rev);
        det.append(box);
    } else {
        det.append('<div class="nnb-empty">Модель сама предложит выбрать наряд, когда он будет важен для сцены. Или подбери сейчас.</div>');
    }
    const wardBtns = $('<div class="nnb-buttons" style="margin-top:8px;"></div>');
    wardBtns.append($(`<div class="menu_button"><i class="fa-solid fa-shirt"></i> Шкаф (${(w.closet || []).length}) — переодеться</div>`).on('click', openClosetPopup));
    wardBtns.append($('<div class="menu_button"><i class="fa-solid fa-wand-magic-sparkles"></i> Сгенерировать 5 новых образов</div>').on('click', () => promptGenerateNewOutfits()));
    det.append(wardBtns);

    if ((w.closet || []).length) {
        const clDet = $('<details open class="nnb-section"><summary></summary></details>');
        clDet.find('summary').text(`👚 Сохранённые наряды в шкафу (${w.closet.length})`);
        w.closet.forEach(item => {
            const isWorn = a?.status === 'worn' && a.look?.title === item.title;
            const row = $('<div class="nnb-note"><div class="nnb-meta"></div><div class="nnb-npc-text"></div><div class="nnb-actions"><i class="fa-solid fa-shirt" title="Надеть сейчас (без запросов)"></i><i class="fa-solid fa-pen" title="Изменить"></i><i class="fa-solid fa-trash" title="Удалить"></i></div></div>');
            row.find('.nnb-meta').text(`${item.category || 'Повседневный'}${item.season ? ` · ${item.season}` : ''}${isWorn ? ' · 👕 надето сейчас' : ''}`);
            row.find('.nnb-npc-text').text(`«${item.title}» — ${item.desc}`);
            row.find('.fa-shirt').on('click', () => wearFromCloset(item));
            row.find('.fa-pen').on('click', async () => {
                const t = await askText('Название наряда', item.title);
                if (t === null) return;
                const c = await askText('Категория (Повседневный, Рабочий, На выход, Домашний, По погоде, Спортивный)', item.category || 'Повседневный');
                if (c === null) return;
                const d = await askText('Описание наряда', item.desc);
                if (d === null) return;
                if (t.trim()) item.title = t.trim();
                item.category = normalizeClosetCat(c);
                item.desc = d.trim();
                await commit();
            });
            row.find('.fa-trash').on('click', async () => {
                w.closet = w.closet.filter(x => x.id !== item.id);
                await commit();
            });
            clDet.append(row);
        });
        det.append(clDet);
    }

    const aura = auraInjection(st);
    if (aura) det.append($('<div class="nnb-npc-status"></div>').text(`💎 Сейчас действует талисман: ${w.aura.title}${w.aura.effects ? ` — ${w.aura.effects}` : ''}`));
    if (w.history.length) {
        const hist = $('<details><summary></summary></details>');
        hist.find('summary').text(`История образов (${w.history.length})`);
        [...w.history].reverse().forEach(h => {
            const row = $('<div class="nnb-note"><div class="nnb-meta"></div><div class="nnb-npc-text"></div><div class="nnb-npc-status"></div></div>');
            row.find('.nnb-meta').text([h.date ? formatDate(h.date) : '', h.occasion].filter(Boolean).join(' · '));
            row.find('.nnb-npc-text').text(`«${h.title}»${h.accent ? ` + ${(ACCENT_KINDS[h.accent.kind] || ACCENT_KINDS.accessory).icon} ${h.accent.title}` : ''}`);
            row.find('.nnb-npc-status').text(h.result);
            row.css('cursor', 'pointer').on('click', () => openPopup(revealCard(h)));
            hist.append(row);
        });
        det.append(hist);
    }
}

// Метки в ответе модели: <!--✓2--> (задача праздника выполнена), <!--день+1--> (наступил следующий день)

function parseActionPrompts(raw) {
    if (!raw) return [];
    let text = String(raw).trim().replace(/[*_~`]/g, '');
    let parts = [];
    if (text.includes('|')) {
        parts = text.split('|');
    } else if (text.includes('\n')) {
        parts = text.split(/\r?\n/);
    } else if (text.includes(' / ')) {
        parts = text.split(' / ');
    } else {
        parts = text.split(/(?:^|\s+)(?:\d+[.)]\s*|[•-]\s*)/).filter(Boolean);
    }
    return parts.map(p => {
        return p.trim()
            .replace(/^[-*•\d.)\s]+/, '')
            .replace(/^[\[«"']|[\]»"']$/g, '')
            .replace(/^[-—–\s]+/, '')
            .trim();
    }).filter(p => p.length > 1 && !/^actions?$/i.test(p)).slice(0, 5);
}

function chooseActionPrompt(text, autoSend = false) {
    const textarea = $('#send_textarea');
    if (!textarea.length) return;
    textarea.val(text).trigger('input').focus();
    try {
        textarea[0].dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { /* ignore */ }
    try {
        textarea[0]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { /* ignore */ }
    if (autoSend) {
        const sendBtn = $('#send_but');
        if (sendBtn.length) {
            setTimeout(() => sendBtn.trigger('click'), 60);
        }
    }
}

function ensureActionStyles() {
    if (document.getElementById('nnb-action-styles')) return;
    const style = document.createElement('style');
    style.id = 'nnb-action-styles';
    style.textContent = `
        #chat .mes .nnb-action-prompts,
        #chat .nnb-action-prompts,
        .mes_text .nnb-action-prompts,
        .mes_block .nnb-action-prompts,
        .nnb-action-prompts {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            clear: both !important;
            margin: 14px 0 6px 0 !important;
            padding: 10px 14px !important;
            border-radius: 12px !important;
            border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #8b78c4) 28%, transparent) !important;
            background: color-mix(in srgb, var(--SmartThemeQuoteColor, #8b78c4) 8%, transparent) !important;
            overflow: visible !important;
        }
        #chat .mes .nnb-action-prompts-head,
        .nnb-action-prompts-head {
            font-size: 0.85em !important;
            font-weight: 600 !important;
            opacity: 0.85 !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            color: var(--SmartThemeQuoteColor, #8b78c4) !important;
            margin-bottom: 8px !important;
        }
        #chat .mes .nnb-action-chips,
        #chat .nnb-action-chips,
        .nnb-action-chips {
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            width: 100% !important;
            box-sizing: border-box !important;
        }
        #chat .mes .nnb-action-chip,
        #chat .nnb-action-chip,
        .nnb-action-chip {
            display: block !important;
            width: 100% !important;
            box-sizing: border-box !important;
            padding: 10px 14px !important;
            border-radius: 10px !important;
            border: 1px solid var(--SmartThemeBorderColor) !important;
            background: color-mix(in srgb, var(--SmartThemeBodyColor, #fff) 8%, transparent) !important;
            color: var(--SmartThemeBodyColor, inherit) !important;
            font-size: 0.92em !important;
            cursor: pointer !important;
            line-height: 1.4 !important;
            white-space: normal !important;
            word-break: normal !important;
            overflow-wrap: break-word !important;
            text-align: left !important;
            transition: all 0.15s ease !important;
            user-select: none !important;
        }
        .nnb-action-chip:hover {
            border-color: var(--SmartThemeQuoteColor, #8b78c4) !important;
            background: color-mix(in srgb, var(--SmartThemeQuoteColor, #8b78c4) 14%, transparent) !important;
        }
        .nnb-action-chip:active {
            transform: translateY(1px) !important;
        }
        .nnb-action-custom {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            border-style: dashed !important;
            opacity: 0.8 !important;
        }
        .nnb-action-custom:hover {
            opacity: 1 !important;
        }
    `;
    document.head.appendChild(style);
}

function renderActionPrompts() {
    $('.nnb-action-prompts').remove();
    const s = settings();
    if (!s.enabled || !s.actionPrompts) return;
    const c = ctx();
    const chat = c.chat;
    if (!chat || !chat.length) return;

    ensureActionStyles();

    const lastIdx = chat.length - 1;
    const lastMsg = chat[lastIdx];
    if (!lastMsg || lastMsg.is_user) return;

    if (!Array.isArray(lastMsg.extra?.actions) || !lastMsg.extra.actions.length) {
        if (typeof lastMsg.mes === 'string') {
            const m = lastMsg.mes.match(/(?:<!--\s*ACTIONS|\[\s*(?:ACTIONS|Варианты действий)|(?:\n|^)\s*ACTIONS)\s*[:：]\s*([\s\S]+?)(?:-->|\]|\n\n|$)/i);
            if (m) {
                lastMsg.extra = lastMsg.extra || {};
                lastMsg.extra.actions = parseActionPrompts(m[1]);
            }
        }
    }

    if (!Array.isArray(lastMsg.extra?.actions) || !lastMsg.extra.actions.length) return;

    let mesEl = $(`#chat .mes[mesid="${lastIdx}"]`);
    if (!mesEl.length) mesEl = $('#chat .mes').last();
    if (!mesEl.length) return;

    const container = $('<div class="nnb-action-prompts"></div>');
    container.css({
        'display': 'block',
        'width': '100%',
        'max-width': '100%',
        'box-sizing': 'border-box',
        'clear': 'both',
        'margin': '14px 0 6px 0',
        'padding': '10px 14px'
    });

    const head = $('<div class="nnb-action-prompts-head"><i class="fa-solid fa-lightbulb"></i> Что сделать дальше:</div>');
    container.append(head);

    const list = $('<div class="nnb-action-chips"></div>');
    list.css({
        'display': 'flex',
        'flex-direction': 'column',
        'gap': '8px',
        'width': '100%',
        'box-sizing': 'border-box'
    });

    lastMsg.extra.actions.forEach((actText) => {
        const chip = $('<div class="nnb-action-chip" tabindex="0"></div>').text(actText);
        chip.css({
            'display': 'block',
            'width': '100%',
            'box-sizing': 'border-box',
            'padding': '10px 14px',
            'border-radius': '10px',
            'white-space': 'normal',
            'word-break': 'normal',
            'overflow-wrap': 'break-word',
            'text-align': 'left',
            'line-height': '1.4',
            'cursor': 'pointer'
        });
        chip.attr('title', 'Нажми, чтобы выбрать этот вариант');

        chip.on('click', function(e) {
            e.stopPropagation();
            chooseActionPrompt(actText, false);
        });

        list.append(chip);
    });

    const customChip = $('<div class="nnb-action-chip nnb-action-custom" tabindex="0"><i class="fa-solid fa-pen"></i> <span>Свой вариант</span></div>');
    customChip.css({
        'display': 'flex',
        'flex-direction': 'row',
        'align-items': 'center',
        'gap': '10px',
        'width': '100%',
        'box-sizing': 'border-box',
        'padding': '10px 14px',
        'border-radius': '10px',
        'white-space': 'normal',
        'cursor': 'pointer'
    });
    customChip.attr('title', 'Написать свой вариант действия');
    customChip.on('click', function(e) {
        e.stopPropagation();
        const textarea = $('#send_textarea');
        textarea.focus();
        try {
            textarea[0]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        } catch (err) { /* ignore */ }
    });
    list.append(customChip);

    container.append(list);

    const textEl = mesEl.find('.mes_text').first();
    const mesBlock = mesEl.find('.mes_block').first();
    if (textEl.length) {
        textEl.append(container);
    } else if (mesBlock.length) {
        mesBlock.append(container);
    } else {
        mesEl.append(container);
    }
}

let actionPromptsTimer = null;
function renderActionPromptsSoon() {
    clearTimeout(actionPromptsTimer);
    actionPromptsTimer = setTimeout(renderActionPrompts, 100);
}

async function processReplyTags() {
    const st = store();
    const s = settings();
    if (!st || !s.enabled) return false;
    const c = ctx();
    const chat = c.chat;
    if (!chat || !chat.length) return false;
    const id = chat.length - 1;
    const msg = chat[id];
    if (!msg || msg.is_user || typeof msg.mes !== 'string') return false;

    let modified = false;

    // 1. Process ACTIONS tags (<!--ACTIONS: ...-->, [ACTIONS: ...], or ACTIONS: ...)
    const actMatch = msg.mes.match(/<!--\s*ACTIONS\s*[:：]\s*([\s\S]+?)\s*-->/i)
        || msg.mes.match(/\[\s*(?:ACTIONS|Варианты действий)\s*[:：]\s*([\s\S]+?)\s*\]/i)
        || msg.mes.match(/(?:^|\n)\s*(?:<!--\s*)?ACTIONS\s*[:：]\s*([\s\S]+?)(?:-->|$)/i);
    if (actMatch) {
        const parsed = parseActionPrompts(actMatch[1]);
        if (parsed.length) {
            msg.extra = msg.extra || {};
            msg.extra.actions = parsed;
            modified = true;
        }
        msg.mes = msg.mes
            .replace(/<!--\s*ACTIONS\s*[:：][\s\S]+?\s*-->/gi, '')
            .replace(/\[\s*(?:ACTIONS|Варианты действий)\s*[:：][\s\S]+?\s*\]/gi, '')
            .replace(/(?:^|\n)\s*(?:<!--\s*)?ACTIONS\s*[:：][\s\S]+?(?:-->|$)/gi, '')
            .trimEnd();
    }

    // 2. Process time/holiday tags
    if (st.direction.time && msg.mes.includes('<!--')) {
        const res = {};
        if (applyReplyTags(st, msg.mes, res)) {
            msg.mes = stripTags(msg.mes);
            modified = true;
            const parts = holidaySummary(res);
            if (res.timeMoved) parts.unshift(`📅 прошло ${daysWord(res.timeMoved)} → ${formatDate(st.time.date)}`);
            if (parts.length && s.showToasts) toastr.success(parts.map(escapeHtml).join('<br>'), 'Блокнот рассказчика', { escapeHtml: false, timeOut: 8000 });
            await c.saveMetadata();
            if (res.timeMoved) await runHolidayStep();
        }
    }

    if (modified) {
        try {
            if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(id, msg);
            await c.saveChat();
        } catch (e) { /* ignore */ }
        renderActionPromptsSoon();
        return true;
    }
    return false;
}

// Подсказка гардероба: игрок сам пишет, что выбирает одежду
const OUTFIT_HINT_RE = /(наряд|что (бы )?надеть|во что (бы )?(одеться|нарядиться)|переоде(ться|нусь|ваюсь|лась)|выбира\S* (одежд|платье|образ|костюм|что надеть)|гардероб|собира\S* на (свидание|вечеринк|ужин|собеседовани|бал|праздник|вечер))/i;
let outfitHintPending = false;
function onMessageSentHint() {
    const c = ctx();
    const st = store();
    const msg = c.chat?.[c.chat.length - 1];
    outfitHintPending = !!(settings().enabled && st?.direction?.wardrobe && !st.wardrobe.active && msg?.is_user && OUTFIT_HINT_RE.test(String(msg.mes || '')));
}
function showOutfitHint() {
    if (!outfitHintPending) return;
    outfitHintPending = false;
    const st = store();
    if (!st || st.wardrobe.active) return;
    const len = ctx().chat?.length ?? 0;
    if (st.wardrobe.lastHintAt && len - st.wardrobe.lastHintAt < 10) return;
    st.wardrobe.lastHintAt = len;
    toastr.info('Похоже, пора выбрать наряд. Нажми, чтобы подобрать образы.', '👗 Гардероб', { timeOut: 15000, extendedTimeOut: 5000, onclick: () => startWardrobe() });
}

function clearFastForward() {
    if (!ffPending) return;
    ffPending = false;
    ctx().setExtensionPrompt(INJECT_FF_KEY, '', POS_IN_CHAT, 0);
}

async function onMessageReceived() {
    clearFastForward();
    clearGachaPending();
    setTimeout(showOutfitHint, 1500);
    try { await processReplyTags(); } catch (e) { console.error('[npc_notebook] reply tags', e); }
    onMessageReceivedThink();
}

function onMessageReceivedThink() {
    updateInjection();
    renderPanel();
    const s = settings();
    const st = store();
    if (!s.enabled || !st || busy) return;
    const len = ctx().chat.length;
    if (st.lastThinkAt > len) st.lastThinkAt = len; // сообщения удаляли
    if (len - st.lastThinkAt >= (Number(s.interval) || 12)) {
        setTimeout(() => think(false), 800);
    }
}

// ---------- интерфейс ----------


// ===================== 🌍 Создание мира и персонажа (Стартовый набор за 1 запрос) =====================
const WORLD_PRESETS = {
    countries: [
        { code: 'UK', label: '🇬🇧 Великобритания', countryName: 'Великобритания', cities: ['Лондон', 'Эдинбург', 'Оксфорд', 'Брайтон', 'Тихий прибрежный городок в Корнуолле'] },
        { code: 'US', label: '🇺🇸 США', countryName: 'США', cities: ['Нью-Йорк', 'Лос-Анджелес', 'Сиэтл', 'Бостон', 'Чикаго', 'Уютный городок в Новой Англии'] },
        { code: 'JP', label: '🇯🇵 Япония', countryName: 'Япония', cities: ['Токио', 'Киото', 'Осака', 'Иокогама', 'Приморский городок на Хоккайдо'] },
        { code: 'RU', label: '🇷🇺 Россия', countryName: 'Россия', cities: ['Москва', 'Санкт-Петербург', 'Владивосток', 'Калининград', 'Уютный южный приморский город'] },
        { code: 'other', label: '🇪🇺 Европа / Азия', countryName: 'Франция', cities: ['Париж, Франция', 'Рим, Италия', 'Сеул, Южная Корея', 'Прага, Чехия', 'Вена, Австрия', 'Барселона, Испания'] },
        { code: 'other', label: '✨ Авторский / Фэнтези', countryName: 'Авторский мир', cities: ['По лору карточки', 'Столица королевства', 'Вольный портовый город', 'Город при Академии магии', 'Неоновый мегаполис'] },
    ],
    seasons: [
        { id: 'autumn', label: '🍂 Осень', date: '2024-10-12' },
        { id: 'winter', label: '❄️ Зима', date: '2024-12-08' },
        { id: 'spring', label: '🌸 Весна', date: '2025-04-14' },
        { id: 'summer', label: '☀️ Лето', date: '2025-07-10' },
    ],
    homes: [
        'Живёт в своей квартире (одна, без соседей)',
        'Уютная маленькая студия в центре',
        'Квартира с соседом / соседкой',
        'Небольшой частный дом на тихой улочке',
        'Просторный лофт / пентхаус с панорамными окнами',
        'Комната в студенческом кампусе / общежитии',
        'Уединённый загородный коттедж',
    ],
    startVibes: [
        'Давно здесь живёт и знает район как свои пять пальцев',
        'Только переехала сюда и обустраивается на новом месте',
        'Начинает жизнь с чистого листа в новом месте',
        'Приехала сюда в отпуск / длительную поездку',
    ],
    jobs: [
        'Бариста в уютной кофейне',
        'Иллюстратор / дизайнер на фрилансе',
        'Журналистка / писательница',
        'Студентка университета',
        'Хозяйка небольшой книжной или цветочной лавки',
        'Фотограф',
        'Детектив / частный расследователь',
        'Врач / психолог',
        'Специалист в офисе / маркетолог',
        'Музыкант / актриса',
        'Преподаватель',
        'Кондитер в пекарне',
        'В свободном поиске (временно без работы)',
    ],
    hobbies: [
        '📷 Фотография на плёнку',
        '🧁 Выпечка и кулинария',
        '📚 Чтение и букинистические лавки',
        '🎨 Живопись и скетчинг',
        '💃 Танцы и пластика',
        '🧘‍♀️ Йога и пробежки по утрам',
        '🎮 Видеоигры и настолки',
        '🌿 Комнатные растения и садоводство',
        '🎸 Музыка и коллекционирование винила',
        '🕰 Блошиные рынки и винтаж',
        '🌙 Ночные прогулки по городу',
        '🧵 Мода и рукоделие',
    ],
    wealths: [
        'Комфортный средний достаток',
        'Бюджет впритык (копит на мечту)',
        'Обеспеченная (ни в чём себе не отказывает)',
    ],
    pets: [
        'Без питомца',
        '🐈 Кот / кошка',
        '🐕 Собака',
        '🐦 Необычный питомец',
    ],
    charModes: [
        { id: 'free', label: '🌍 Свободная игра без стартового любовного интереса (фокус на мире, а фаворита встретим по сюжету и отметим ❤️ в блокноте)', freeWorld: true },
        { id: 'strangers', label: '✨ Ещё не знакомы с {{char}} (случайное пересечение)', freeWorld: false },
        { id: 'colleagues', label: '💼 Коллеги / работаем или учимся вместе', freeWorld: false },
        { id: 'neighbors', label: '🔑 Соседи по дому или улице', freeWorld: false },
        { id: 'friends', label: '🤝 Старые друзья / хорошие знакомые', freeWorld: false },
        { id: 'exes', label: '💔 Бывшие (сложная история в прошлом)', freeWorld: false },
        { id: 'chat', label: '💬 Как задано в первом сообщении чата', freeWorld: false },
    ],
};

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildWorldCreationPrompt(st, cfg) {
    const names = storyNames();
    const sName = cfg.date ? season(cfg.date).name : 'осень';
    const hobbiesStr = (cfg.hobbies || []).join(', ') || 'прогулки по городу';
    const charLine = cfg.freeWorld
        ? `Формат игры: СВОБОДНОЕ ИССЛЕДОВАНИЕ МИРА без привязки к одному стартовому фавориту. Не привязывай всё к ${names.char} — создай живое окружение вокруг ${names.user}, включая 1–2 харизматичных новых NPC с потенциалом интересного знакомства или романтической линии.`
        : `Отношения с ${names.char} на старте: ${cfg.charRel}.`;

    return `[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. Ты — ведущий автор и создаёшь полный стартовый набор мира и персонажа (${names.user}) по выбранным параметрам.

Параметры старта:
— Место действия: ${cfg.city}${cfg.countryName ? `, ${cfg.countryName}` : ''}.
— Дата и сезон: ${cfg.date ? `${formatDate(cfg.date)} (${sName})` : sName}.
— Жильё ${names.user}: ${cfg.home}.
— Точка старта: ${cfg.startVibe}.
— Профессия / занятие ${names.user}: ${cfg.job}.
— Хобби и увлечения ${names.user}: ${hobbiesStr}.
— Достаток: ${cfg.wealth}.${cfg.pet && cfg.pet !== 'Без питомца' ? ` Питомец дома: ${cfg.pet}.` : ''}
— ${charLine}
${buildDirection(st)}

Сгенерируй за один раз весь стартовый пакет строго по шаблону ниже, без вступлений и пояснений:

1) Местный колорит города/мира (1 строка):
FLAVOR: 2–3 предложения о колорите места (еда, валюта, транспорт, погода в сезон «${sName}», атмосфера улиц и привычки местных)

2) 5 стартовых локаций на Карте (дом ${names.user}, место работы/учёбы, место под хобби, уютное кафе/бар и одно необычное/тайное место города). В КАЖДУЮ локацию обязательно заложи сразу 2–3 конкретных сюжетных крючка через точку с запятой (необычная деталь, слух, местная странность, колоритный завсегдатай или микро-сценка):
MAP: название места | что это за место (1 предложение) | крючок 1; крючок 2; крючок 3
(ровно 5 строк MAP)

3) 4 стартовых NPC из окружения ${names.user} (например: коллега/начальник по работе «${cfg.job}», подруга или сосед, знакомый по хобби «${hobbiesStr}», интересный незнакомец/потенциальный фаворит) и их связи с ${names.user}:
NPC [Имя]: кто это, возраст, внешность, характер и отношение к ${names.user} (1–2 предложения)
REL [${names.user} ↔ Имя]: тип связи | что между ними сейчас
(4 пары строк NPC и REL)

4) Базовый капсульный гардероб ${names.user} на сезон «${sName}» — ровно 10 нарядов под разные поводы (3 Повседневный, 2 Рабочий, 2 На выход, 1 Домашний, 1 По погоде, 1 Спортивный), учитывая достаток (${cfg.wealth}) и профессию (${cfg.job}):
CLOSET: категория (Повседневный|Рабочий|На выход|Домашний|По погоде|Спортивный) | название образа | подробное описание: что надето, обувь, причёска, детали (1–2 предложения)
(ровно 10 строк CLOSET)

5) Стартовая шкатулка ${names.user} — 2 флакона духов под разное настроение и 3 аксессуара/украшения:
BOX: духи|аксессуар | название | описание и настроение вещи в 1 предложении
(ровно 5 строк BOX)]`;
}

function applyWorldCreationResult(st, cfg, raw) {
    const counts = { places: 0, npcs: 0, closet: 0, box: 0 };
    const lines = answerLines(raw);
    const len = ctx().chat?.length ?? 0;

    for (const line of lines) {
        let m = line.match(/^FLAVOR\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            st.time.flavor = cleanFlavor(m[1]);
            continue;
        }
        m = line.match(/^MAP\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const pl = addPlace(st, m[1], 'start');
            if (pl) {
                counts.places++;
                if (counts.places === 1 && !st.map.current) st.map.current = pl.id;
            }
            continue;
        }
        m = line.match(/^NPC(?!STATE)\s*[:：]?\s*\[?([^\]:：—–\n]{1,60}?)\]?\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/i);
        if (m) {
            const name = m[1].trim();
            const desc = m[2].trim();
            if (name && !findNpc(st, name)) {
                st.npcs.push({ id: st.nextNpcId++, name, card: desc, status: '', locked: false, at: len });
                counts.npcs++;
            }
            continue;
        }
        m = line.match(/^REL\s*[:：]?\s*\[?([^\[:：—–\n]+?)\s*(↔|<->|->|→)\s*([^\]:：—–\n]+?)\]?\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const a = m[1].trim();
            const arrow = (m[2] === '->' || m[2] === '→') ? '→' : '↔';
            const b = m[3].trim();
            const rest = m[4].trim().replace(/\]$/, '');
            const parts = rest.split('|').map(x => x.trim());
            const type = parts.length > 1 ? parts[0] : 'знакомые';
            const desc = parts.length > 1 ? parts.slice(1).join(' | ') : rest;
            if (!findRel(st, a, b)) {
                st.relationships.push({ id: st.nextRelId++, a, b, arrow, type, desc, locked: false, at: len });
            }
            continue;
        }
        m = line.match(/^CLOSET\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const parts = m[1].split('|').map(x => x.trim());
            if (parts.length >= 2) {
                const cat = parts.length >= 3 ? parts[0] : 'Повседневный';
                const title = (parts.length >= 3 ? parts[1] : parts[0]).replace(/^[«"]|[»"]$/g, '');
                const desc = (parts.length >= 3 ? parts.slice(2).join(' | ') : parts[1]).replace(/\]$/, '');
                if (addLookToCloset(st, { category: cat, title, desc })) counts.closet++;
            }
            continue;
        }
        m = line.match(/^BOX\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const parts = m[1].split('|').map(x => x.trim());
            if (parts.length >= 2) {
                const kind = accentKind(parts[0]);
                const title = (parts.length >= 3 ? parts[1] : parts[0]).replace(/^[«"]|[»"]$/g, '');
                const desc = (parts.length >= 3 ? parts.slice(2).join(' | ') : parts[1]).replace(/\]$/, '');
                if (title && !st.wardrobe.box.some(x => x.title.toLowerCase() === title.toLowerCase())) {
                    st.wardrobe.box.push({ id: st.wardrobe.nextItemId++, kind, title, desc, origin: 'стартовый набор', at: len });
                    counts.box++;
                }
            }
            continue;
        }
    }

    // Если сейчас ничего не надето — сразу надеваем первый повседневный или домашний образ из шкафа
    if (!st.wardrobe.active && st.wardrobe.closet.length) {
        const firstLook = st.wardrobe.closet.find(c => c.category === 'Повседневный') || st.wardrobe.closet[0];
        st.wardrobe.active = {
            occasion: firstLook.category || 'Стартовый образ',
            look: { title: firstLook.title, desc: firstLook.desc, category: firstLook.category },
            options: [firstLook],
            accents: [],
            status: 'worn',
            at: len,
            date: st.time.date || '',
        };
    }

    return counts;
}

async function openWorldCreator() {
    const st = store();
    if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (busy) return toastr.info('Модель уже занята — подожди пару секунд', 'Блокнот рассказчика');

    const prev = st.worldProfile || {};
    const cfg = {
        countryCode: st.time?.country || prev.countryCode || 'UK',
        countryName: st.time?.countryName || prev.countryName || '',
        city: st.time?.city || prev.city || 'Лондон',
        date: st.time?.date || prev.date || '2024-10-12',
        home: prev.home || WORLD_PRESETS.homes[0],
        startVibe: prev.startVibe || WORLD_PRESETS.startVibes[0],
        job: prev.job || WORLD_PRESETS.jobs[0],
        hobbies: Array.isArray(prev.hobbies) && prev.hobbies.length ? [...prev.hobbies] : [WORLD_PRESETS.hobbies[0], WORLD_PRESETS.hobbies[2]],
        wealth: prev.wealth || WORLD_PRESETS.wealths[0],
        pet: prev.pet || WORLD_PRESETS.pets[0],
        charRel: prev.charRel || WORLD_PRESETS.charModes[0].label.replace(/\{\{char\}\}/g, storyNames().char),
        freeWorld: prev.freeWorld !== undefined ? prev.freeWorld : true,
    };

    const el = $('<div class="nnb-pop nnb-world-creator"><h3>🌍 Создание мира и стартового набора</h3></div>');
    el.append('<div class="nnb-pop-sub">Выбери готовые параметры ниже (кубик 🎲 крутит их бесплатно, карандаш ✏️ даёт вписать своё). В конце по кнопке <b>«Создать мир»</b> модель за <b>1 запрос</b> соберёт 5 локаций с 2–3 крючками, стартовых NPC, капсульный гардероб на 10 нарядов по сезону и шкатулку с духами и аксессуарами!</div>');

    // Helper for single-choice chip section with 🎲 and ✏️
    const buildSingleSection = (title, options, getVal, setVal, askLabel) => {
        const sec = $('<div style="margin-top:12px;"></div>');
        const head = $('<div class="nnb-travel-sec-title" style="display:flex; justify-content:space-between; align-items:center;"></div>');
        head.append($('<span></span>').text(title));
        const tools = $('<div style="display:flex; gap:6px;"></div>');
        const diceBtn = $('<div class="menu_button" style="padding:2px 8px; font-size:0.85em;" title="Случайный вариант"><i class="fa-solid fa-dice"></i></div>');
        const penBtn = $('<div class="menu_button" style="padding:2px 8px; font-size:0.85em;" title="Вписать свой вариант"><i class="fa-solid fa-pen"></i> Своё</div>');
        tools.append(diceBtn, penBtn);
        head.append(tools);
        const chipsRow = $('<div class="nnb-chips-row nnb-travel-chips"></div>');

        const renderChips = () => {
            chipsRow.empty();
            const cur = getVal();
            const allOpts = options.includes(cur) || !cur ? options : [...options, cur];
            allOpts.forEach(opt => {
                const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(opt);
                if (opt === cur) chip.addClass('active');
                chip.on('click', () => {
                    setVal(opt);
                    renderChips();
                });
                chipsRow.append(chip);
            });
        };
        diceBtn.on('click', () => {
            setVal(pickRandom(options));
            renderChips();
        });
        penBtn.on('click', async () => {
            const custom = await askText(askLabel || title, getVal());
            if (custom && custom.trim()) {
                setVal(custom.trim());
                renderChips();
            }
        });
        renderChips();
        sec.append(head, chipsRow);
        el.append(sec);
    };

    // 1. Страна и город
    const locSec = $('<div style="margin-top:10px;"></div>');
    const locHead = $('<div class="nnb-travel-sec-title" style="display:flex; justify-content:space-between; align-items:center;"><span>🗺 1. Страна и город (или мир)</span></div>');
    const locTools = $('<div style="display:flex; gap:6px;"></div>');
    const locDice = $('<div class="menu_button" style="padding:2px 8px; font-size:0.85em;" title="Случайная страна и город"><i class="fa-solid fa-dice"></i></div>');
    const locPen = $('<div class="menu_button" style="padding:2px 8px; font-size:0.85em;" title="Своя страна и город"><i class="fa-solid fa-pen"></i> Своё</div>');
    locTools.append(locDice, locPen);
    locHead.append(locTools);
    const countryChips = $('<div class="nnb-chips-row nnb-travel-chips"></div>');
    const cityChips = $('<div class="nnb-chips-row nnb-travel-chips" style="margin-top:6px;"></div>');
    const locSummary = $('<div class="nnb-pop-sub" style="margin-top:4px;"></div>');

    let selectedPresetCountry = WORLD_PRESETS.countries.find(c => c.code === cfg.countryCode && c.code !== 'other') || WORLD_PRESETS.countries[0];

    const renderLoc = () => {
        countryChips.empty();
        WORLD_PRESETS.countries.forEach(cObj => {
            const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(cObj.label);
            if (cObj === selectedPresetCountry) chip.addClass('active');
            chip.on('click', () => {
                selectedPresetCountry = cObj;
                cfg.countryCode = cObj.code === 'other' ? '' : cObj.code;
                cfg.countryName = cObj.code === 'other' ? cObj.countryName : '';
                cfg.city = cObj.cities[0];
                renderLoc();
            });
            countryChips.append(chip);
        });
        cityChips.empty();
        const cities = [...selectedPresetCountry.cities];
        if (cfg.city && !cities.includes(cfg.city)) cities.push(cfg.city);
        cities.forEach(cityStr => {
            const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(cityStr);
            if (cityStr === cfg.city) chip.addClass('active');
            chip.on('click', () => {
                if (cityStr.includes(',')) {
                    const [cPart, cnPart] = cityStr.split(',').map(x => x.trim());
                    cfg.city = cPart;
                    cfg.countryName = cnPart;
                    cfg.countryCode = '';
                } else {
                    cfg.city = cityStr;
                }
                renderLoc();
            });
            cityChips.append(chip);
        });
        const cLabel = COUNTRIES[cfg.countryCode]?.name || cfg.countryName || selectedPresetCountry.countryName;
        locSummary.text(`Выбрано место: ${cfg.city}${cLabel ? ` (${cLabel})` : ''}`);
    };
    locDice.on('click', () => {
        selectedPresetCountry = pickRandom(WORLD_PRESETS.countries);
        const rawCity = pickRandom(selectedPresetCountry.cities);
        if (rawCity.includes(',')) {
            const [cPart, cnPart] = rawCity.split(',').map(x => x.trim());
            cfg.city = cPart;
            cfg.countryName = cnPart;
            cfg.countryCode = '';
        } else {
            cfg.city = rawCity;
            cfg.countryCode = selectedPresetCountry.code === 'other' ? '' : selectedPresetCountry.code;
            cfg.countryName = selectedPresetCountry.code === 'other' ? selectedPresetCountry.countryName : '';
        }
        renderLoc();
    });
    locPen.on('click', async () => {
        const cn = await askText('Страна или название мира (например «Италия», «Южная Корея», «Королевство Эльфов»)', COUNTRIES[cfg.countryCode]?.name || cfg.countryName || '');
        if (cn === null) return;
        const ct = await askText('Город или конкретное место старта', cfg.city);
        if (ct === null) return;
        const detected = detectCountry(cn);
        cfg.countryCode = detected || '';
        cfg.countryName = detected ? '' : cn.trim();
        if (ct.trim()) cfg.city = ct.trim();
        renderLoc();
    });
    renderLoc();
    locSec.append(locHead, countryChips, cityChips, locSummary);
    el.append(locSec);

    // 2. Сезон и дата
    const seasSec = $('<div style="margin-top:12px;"></div>');
    seasSec.append('<div class="nnb-travel-sec-title">🍂 2. Сезон и стартовая дата</div>');
    const seasRow = $('<div class="nnb-chips-row nnb-travel-chips" style="align-items:center;"></div>');
    const dateInput = $('<input type="date" class="text_pole" style="width:155px; margin-left:6px;">').val(cfg.date);
    const renderSeasons = () => {
        seasRow.find('.nnb-travel-chip').remove();
        const curS = cfg.date ? season(cfg.date).name : 'осень';
        WORLD_PRESETS.seasons.forEach(sObj => {
            const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(sObj.label);
            if (sObj.label.toLowerCase().includes(curS)) chip.addClass('active');
            chip.on('click', () => {
                cfg.date = sObj.date;
                dateInput.val(cfg.date);
                renderSeasons();
            });
            seasRow.prepend(chip);
        });
    };
    dateInput.on('change', () => {
        if (dateInput.val()) {
            cfg.date = dateInput.val();
            renderSeasons();
        }
    });
    seasRow.append(dateInput);
    renderSeasons();
    seasSec.append(seasRow);
    el.append(seasSec);

    // 3. Жильё героини (своя квартира без соседей — первая по умолчанию!)
    buildSingleSection('🏢 3. Где живёт твоя героиня', WORLD_PRESETS.homes, () => cfg.home, v => { cfg.home = v; }, 'Где живёт твоя героиня?');

    // 4. Точка старта
    buildSingleSection('🧭 4. Точка старта в городе', WORLD_PRESETS.startVibes, () => cfg.startVibe, v => { cfg.startVibe = v; }, 'Точка старта / атмосфера');

    // 5. Профессия
    buildSingleSection('💼 5. Профессия / занятие героини', WORLD_PRESETS.jobs, () => cfg.job, v => { cfg.job = v; }, 'Профессия или занятие твоей героини');

    // 6. Хобби (МУЛЬТИВЫБОР — можно выбрать несколько!)
    const hobSec = $('<div style="margin-top:12px;"></div>');
    const hobHead = $('<div class="nnb-travel-sec-title" style="display:flex; justify-content:space-between; align-items:center;"><span>🎨 6. Хобби и увлечения (можно выбрать несколько!)</span></div>');
    const hobTools = $('<div style="display:flex; gap:6px;"></div>');
    const hobDice = $('<div class="menu_button" style="padding:2px 8px; font-size:0.85em;" title="Выбрать 2–3 случайных хобби"><i class="fa-solid fa-dice"></i></div>');
    const hobPen = $('<div class="menu_button" style="padding:2px 8px; font-size:0.85em;" title="Добавить своё хобби"><i class="fa-solid fa-pen"></i> + Своё</div>');
    hobTools.append(hobDice, hobPen);
    hobHead.append(hobTools);
    const hobChips = $('<div class="nnb-chips-row nnb-travel-chips"></div>');
    const allHobbies = [...WORLD_PRESETS.hobbies];

    const renderHobbies = () => {
        hobChips.empty();
        cfg.hobbies.forEach(h => { if (!allHobbies.includes(h)) allHobbies.push(h); });
        allHobbies.forEach(h => {
            const active = cfg.hobbies.includes(h);
            const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(active ? `✓ ${h}` : h);
            if (active) chip.addClass('active');
            chip.on('click', () => {
                if (cfg.hobbies.includes(h)) {
                    if (cfg.hobbies.length > 1) cfg.hobbies = cfg.hobbies.filter(x => x !== h);
                } else {
                    cfg.hobbies.push(h);
                }
                renderHobbies();
            });
            hobChips.append(chip);
        });
    };
    hobDice.on('click', () => {
        const count = 2 + (Math.random() < 0.5 ? 1 : 0);
        cfg.hobbies = shuffle(allHobbies).slice(0, count);
        renderHobbies();
    });
    hobPen.on('click', async () => {
        const custom = await askText('Добавить своё хобби или увлечение');
        if (custom && custom.trim()) {
            const val = custom.trim();
            if (!allHobbies.includes(val)) allHobbies.push(val);
            if (!cfg.hobbies.includes(val)) cfg.hobbies.push(val);
            renderHobbies();
        }
    });
    renderHobbies();
    hobSec.append(hobHead, hobChips);
    el.append(hobSec);

    // 7. Достаток и питомец
    buildSingleSection('💎 7. Достаток и уровень жизни', WORLD_PRESETS.wealths, () => cfg.wealth, v => { cfg.wealth = v; }, 'Достаток героини');
    buildSingleSection('🐾 8. Домашний питомец', WORLD_PRESETS.pets, () => cfg.pet, v => { cfg.pet = v; }, 'Какой питомец живёт дома?');

    // 9. Формат романтики / Кем приходится {{char}}
    const charName = storyNames().char;
    const charModes = WORLD_PRESETS.charModes.map(m => ({ ...m, text: m.label.replace(/\{\{char\}\}/g, charName) }));
    const relSec = $('<div style="margin-top:12px;"></div>');
    const relHead = $('<div class="nnb-travel-sec-title" style="display:flex; justify-content:space-between; align-items:center;"><span>💞 9. Любовный интерес и роль карточки на старте</span></div>');
    const relPen = $('<div class="menu_button" style="padding:2px 8px; font-size:0.85em;"><i class="fa-solid fa-pen"></i> Своё</div>');
    relHead.append(relPen);
    const relChips = $('<div class="nnb-chips-row nnb-travel-chips"></div>');
    const relHint = $('<div class="nnb-pop-sub" style="margin-top:4px;"></div>');

    const renderRel = () => {
        relChips.empty();
        charModes.forEach(m => {
            const chip = $('<div class="nnb-travel-chip" tabindex="0"></div>').text(m.text);
            if (cfg.charRel === m.text) chip.addClass('active');
            chip.on('click', () => {
                cfg.charRel = m.text;
                cfg.freeWorld = m.freeWorld;
                renderRel();
            });
            relChips.append(chip);
        });
        if (!charModes.some(m => m.text === cfg.charRel) && cfg.charRel) {
            const customChip = $('<div class="nnb-travel-chip active" tabindex="0"></div>').text(cfg.charRel);
            relChips.append(customChip);
        }
        relHint.text(cfg.freeWorld
            ? '💡 Совет: в режиме «Свободная игра без стартового любовного интереса» переписывать карточку персонажа потом НЕ нужно! Когда по ходу истории тебе приглянётся любой NPC в блокноте, просто нажми сердечко ❤️ на его карточке во вкладке «👥 Герои» — и плагин сам сделает его главным фаворитом истории.'
            : `На старте учитывается связь с ${charName}: ${cfg.charRel}`);
    };
    relPen.on('click', async () => {
        const custom = await askText(`Кем приходится ${charName} на старте?`, cfg.charRel);
        if (custom && custom.trim()) {
            cfg.charRel = custom.trim();
            cfg.freeWorld = false;
            renderRel();
        }
    });
    renderRel();
    relSec.append(relHead, relChips, relHint);
    el.append(relSec);

    // Кнопка запуска
    const actRow = $('<div class="nnb-pop-row" style="margin-top:16px; gap:10px;"></div>');
    const createBtn = $('<div class="menu_button nnb-btn-primary" style="flex:1; padding:10px 14px; font-weight:600; text-align:center;"><i class="fa-solid fa-wand-magic-sparkles"></i> Создать мир: 5 локаций с крючками + NPC + 10 нарядов в шкаф + духи (1 запрос)</div>');
    const saveOnlyProfileBtn = $('<div class="menu_button" title="Сохранить настройки времени, места и персонажа без запроса к модели"><i class="fa-solid fa-floppy-disk"></i> Только сохранить параметры (0 запросов)</div>');

    const applyBaseSettings = () => {
        st.worldProfile = { ...cfg };
        st.direction.time = true;
        st.direction.map = true;
        st.direction.npcs = true;
        st.direction.wardrobe = true;
        st.direction.livingWorld = true;
        st.time.date = cfg.date;
        st.time.country = cfg.countryCode;
        st.time.countryName = cfg.countryName;
        st.time.city = cfg.city;
    };

    saveOnlyProfileBtn.on('click', async () => {
        applyBaseSettings();
        closePopupOf(el);
        await commit();
        renderDirection();
        toastr.success('Параметры мира, даты и персонажа сохранены!', '🌍 Создание мира');
    });

    createBtn.on('click', async () => {
        applyBaseSettings();
        closePopupOf(el);
        await commit();
        renderDirection();
        await withBusy('🌍 Создаём стартовый мир, 5 локаций с крючками, NPC и 10 нарядов…', async s2 => {
            const raw = await quietGenerate(buildWorldCreationPrompt(s2, cfg));
            s2.lastRaw = String(raw ?? '');
            const counts = applyWorldCreationResult(s2, cfg, raw);
            if (settings().events && s2.time.date) await holidayStep(s2);
            toastr.success(
                `Готово! На карте: ${counts.places} лок. с крючками · NPC: ${counts.npcs} · В шкафу: ${counts.closet} нарядов · В шкатулке: ${counts.box} вещ.`,
                '🌍 Мир создан!',
                { timeOut: 9000 }
            );
        });
    });

    actRow.append(createBtn, saveOnlyProfileBtn);
    el.append(actRow);

    await openPopup(el, true);
}

const PANEL_HTML = `
<div class="npc-notebook-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Блокнот рассказчика</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content nnb-scope" id="nnb_panel">
      <label class="checkbox_label"><input type="checkbox" id="nnb_enabled"> Включено</label>
      <div class="nnb-buttons">
        <div class="menu_button" id="nnb_open_book"><i class="fa-solid fa-book-open"></i> Открыть блокнот</div>
        <div class="menu_button" id="nnb_open_world"><i class="fa-solid fa-earth-americas"></i> Создать мир</div>
      </div>
      <div class="nnb-status"></div>
      <label class="checkbox_label"><input type="checkbox" id="nnb_toasts"> Уведомлять о новых записях</label>
      <label class="checkbox_label"><input type="checkbox" id="nnb_spoilers"> Не подглядывать (размыть записи)</label>
      <label class="checkbox_label"><input type="checkbox" id="nnb_ff_on"> Кнопка ⏩ «Дальше» у поля ввода</label>
      <label class="checkbox_label"><input type="checkbox" id="nnb_accents"> Штрихи к образу и шкатулка</label>
      <label class="checkbox_label"><input type="checkbox" id="nnb_action_prompts"> 💡 Подсказки действий в конце сообщений</label>

      <details class="nnb-set">
        <summary>🎨 Картинки</summary>
        <label class="checkbox_label"><input type="checkbox" id="nnb_ward_img"> Рисовать образы в гардеробе</label>
        <select class="text_pole" id="nnb_img_src" title="Чем рисовать"></select>
        <div id="nnb_img_api" style="display:none">
          <input type="password" class="text_pole" id="nnb_img_key" placeholder="Ключ (sk-…)" autocomplete="off">
          <details>
            <summary>Адрес и модель</summary>
            <input type="text" class="text_pole" id="nnb_img_base" placeholder="https://api.linkapi.ai/v1">
            <input type="text" class="text_pole" id="nnb_img_model" placeholder="gpt-image-2-c">
          </details>
        </div>
        <select class="text_pole" id="nnb_img_orient" title="Формат сцен и образов">
          <option value="portrait">Вертикальные картинки</option>
          <option value="landscape">Горизонтальные картинки</option>
        </select>
        <label class="checkbox_label"><input type="checkbox" id="nnb_img_ref"> Аватар персоны как образец лица</label>
      </details>

      <details class="nnb-set">
        <summary>⚙️ Тонкая настройка</summary>
        <div class="nnb-row"><label for="nnb_interval">Думать каждые N сообщений</label><input type="number" min="2" max="200" class="text_pole" id="nnb_interval"></div>
        <div class="nnb-row"><label for="nnb_depth">Глубина вставки блокнота</label><input type="number" min="0" max="50" class="text_pole" id="nnb_depth"></div>
        <div class="nnb-row"><label for="nnb_max">Максимум активных записей</label><input type="number" min="1" max="50" class="text_pole" id="nnb_max"></div>
        <div class="nnb-row"><label for="nnb_max_int">Максимум активных тайн</label><input type="number" min="1" max="20" class="text_pole" id="nnb_max_int"></div>
        <div class="nnb-row"><label for="nnb_min_stim">Стимулов для сдвига характера</label><input type="number" min="1" max="10" class="text_pole" id="nnb_min_stim"></div>
        <label class="checkbox_label"><input type="checkbox" id="nnb_events"> Праздничные события (традиции и медали)</label>
        <div class="nnb-row"><label for="nnb_lead">За сколько дней напоминать о праздниках</label><input type="number" min="1" max="7" class="text_pole" id="nnb_lead"></div>
        <div class="nnb-row"><label for="nnb_role">Роль вставки</label>
          <select class="text_pole" id="nnb_role">
            <option value="0">system</option>
            <option value="1">user</option>
            <option value="2">assistant</option>
          </select>
        </div>
        <details>
          <summary>Промпт размышления</summary>
          <small>{{notes}} — текущие записи, {{user}} и {{char}} работают как обычно.</small>
          <textarea class="text_pole" id="nnb_think_prompt" rows="10"></textarea>
          <div class="menu_button" id="nnb_reset_think">Вернуть стандартный</div>
        </details>
        <details>
          <summary>Шаблон вставки в чат</summary>
          <textarea class="text_pole" id="nnb_inject_prompt" rows="5"></textarea>
          <div class="menu_button" id="nnb_reset_inject">Вернуть стандартный</div>
        </details>
      </details>
    </div>
  </div>
</div>`;

// Сам блокнот — отдельное окно во весь экран с вкладками
const BOOK_TABS = [
    { id: 'plot', icon: '🧭', title: 'Сюжет' },
    { id: 'ideas', icon: '🪶', title: 'Задумки' },
    { id: 'heroes', icon: '👥', title: 'Герои', need: d => d.npcs || d.arcs },
    { id: 'ward', icon: '👗', title: 'Гардероб', need: d => d.wardrobe },
    { id: 'box', icon: '🎁', title: 'Шкатулка', need: d => d.gacha || (d.wardrobe && !!settings().accents) },
    { id: 'map', icon: '🗺', title: 'Карта', need: d => d.map },
    { id: 'time', icon: '📅', title: 'Время', need: d => d.time },
    { id: 'album', icon: '🖼', title: 'Альбом' },
];
const BOOK_HTML = `
<div id="nnb_book" class="nnb-scope nnb-book" style="display:none">
  <div class="nnb-book-head">
    <b>📓 Блокнот</b>
    <span class="nnb-status"></span>
    <div class="menu_button nnb-book-think" id="nnb_world_now" title="🌍 Создание мира и стартового набора"><i class="fa-solid fa-earth-americas"></i></div>
    <div class="menu_button nnb-book-think" id="nnb_think_now" title="Подумать сейчас"><i class="fa-solid fa-feather"></i></div>
    <div class="menu_button nnb-book-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
  </div>
  <div class="nnb-tabs">${BOOK_TABS.map(t => `<div class="nnb-tab" data-tab="${t.id}">${t.icon} ${t.title}</div>`).join('')}</div>
  <div class="nnb-book-body">
    <div class="nnb-pane" data-pane="plot">
      <div class="nnb-direction" style="border:1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #8b78c4) 40%, transparent); border-radius:10px; padding:10px; margin-bottom:10px;">
        <b>🌍 Быстрый старт и создание мира</b>
        <small>Выбери страну, город, сезон, жильё, профессию и хобби из готовых вариантов и за 1 запрос создай 5 локаций с крючками, стартовых NPC и гардероб на 10 нарядов!</small>
        <div class="nnb-buttons" style="margin-top:6px;">
          <div class="menu_button nnb-btn-primary" id="nnb_create_world_btn"><i class="fa-solid fa-earth-americas"></i> Создать мир и стартовый набор</div>
        </div>
      </div>
      <div class="nnb-direction">
        <b>Направление этого чата</b>
        <small>Если ничего не выбрано, модель придумывает свободно.</small>
        <div class="nnb-chips" id="nnb_genres"></div>
        <input type="text" class="text_pole" id="nnb_custom_genre" placeholder="Свой жанр или настроение">
        <div class="nnb-row"><label for="nnb_mix">Если жанров несколько</label>
          <select class="text_pole nnb-wide" id="nnb_mix">
            <option value="and">Смешивать (И)</option>
            <option value="or">По одному (ИЛИ)</option>
          </select>
        </div>
        <textarea class="text_pole nnb-insp" id="nnb_lines" rows="2" placeholder="Заявленные линии — что обязательно должно быть в истории: например, любовный треугольник Вика, Годжо и Гето"></textarea>
      </div>
      <div class="nnb-direction">
        <b>Что ведёт блокнот в этом чате</b>
        <label class="checkbox_label"><input type="checkbox" id="nnb_intrigues_on"> 🔒 Тайны и интриги</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_npcs_on"> 👥 Карточки NPC</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_arcs_on"> 🌱 Развитие персонажей</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_time_on"> 📅 Время и место</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_wardrobe_on"> 👗 Гардероб</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_gacha_on"> 🎰 Находки и случаи (гача)</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_map_on"> 🗺 Карта</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_living_world_on"> 🌍 Живой мир (истории и точки интереса)</label>
      </div>
      <div class="nnb-buttons">
        <div class="menu_button" id="nnb_clear"><i class="fa-solid fa-broom"></i> Очистить блокнот</div>
      </div>
    </div>
    <div class="nnb-pane" data-pane="ideas">
      <div id="nnb_list"></div>
      <div class="nnb-buttons"><div class="menu_button" id="nnb_add"><i class="fa-solid fa-plus"></i> Добавить задумку</div></div>
      <div id="nnb_intrigue_list"></div>
      <div id="nnb_extra_list"></div>
    </div>
    <div class="nnb-pane" data-pane="heroes"><div id="nnb_npc_list"></div><div id="nnb_arc_list"></div></div>
    <div class="nnb-pane" data-pane="ward"><div id="nnb_wardrobe_box"></div></div>
    <div class="nnb-pane" data-pane="box"><div id="nnb_box_box"></div></div>
    <div class="nnb-pane" data-pane="map"><div id="nnb_map_box"></div></div>
    <div class="nnb-pane" data-pane="time"><div id="nnb_time_box"></div></div>
    <div class="nnb-pane" data-pane="album"><div id="nnb_album_box"></div></div>
  </div>
</div>`;

let bookTab = 'plot';
function bookTabs() {
    const d = store()?.direction || {};
    for (const t of BOOK_TABS) $(`#nnb_book .nnb-tab[data-tab="${t.id}"]`).toggle(!t.need || !!t.need(d));
    const cur = BOOK_TABS.find(t => t.id === bookTab);
    if (cur?.need && !cur.need(d)) bookTab = 'plot';
    $('#nnb_book .nnb-tab').each(function () { $(this).toggleClass('active', $(this).data('tab') === bookTab); });
    $('#nnb_book .nnb-pane').each(function () { $(this).toggle($(this).data('pane') === bookTab); });
}
function openBook(tab) {
    if (!store()) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
    if (tab) bookTab = tab;
    let book = $('#nnb_book');
    if (!book.length) { $('body').append(BOOK_HTML); book = $('#nnb_book'); bindBook(); }
    if (!book.parent().is('body')) book.appendTo('body'); // окно должно лежать прямо в body, иначе его закроют панели Таверны
    book.css({ display: 'flex', 'background-color': solidThemeColor() });
    safeRender('направление', renderDirection);
    safeRender('блокнот', renderPanel);
    bookTabs();
    $('#nnb_book .nnb-book-body').scrollTop(0);
}
// цвет темы бывает полупрозрачным — для окна блокнота берём его без прозрачности
function solidThemeColor() {
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBlurTintColor').trim();
        const m = raw.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
        if (m) return `rgb(${Math.round(m[1])}, ${Math.round(m[2])}, ${Math.round(m[3])})`;
        if (/^#[0-9a-f]{6}/i.test(raw)) return raw.slice(0, 7);
    } catch (e) { /* ignore */ }
    return '#1e1b26';
}
// ошибка в одном разделе не должна ломать весь блокнот — показываем, где именно
const renderErrors = new Set();
function safeRender(name, fn, ...args) {
    try { fn(...args); } catch (e) {
        console.error(`[npc_notebook] ${name}`, e);
        if (!renderErrors.has(name)) {
            renderErrors.add(name);
            toastr.error(`Раздел «${escapeHtml(name)}» не отрисовался: ${escapeHtml(e?.message || e)}`, 'Блокнот рассказчика', { escapeHtml: false, timeOut: 15000 });
        }
    }
}
function bindBook() {
    $('#nnb_book .nnb-book-close').off('click').on('click', closeBook);
    $('#nnb_book').off('click', '.nnb-tab').on('click', '.nnb-tab', function () { bookTab = String($(this).data('tab')); bookTabs(); $('#nnb_book .nnb-book-body').scrollTop(0); });
}
function closeBook() {
    $('#nnb_book').hide();
}

function setStatus(text) {
    if (text) {
        $('.nnb-status').text(text);
        return;
    }
    const st = store();
    const s = settings();
    if (!st) {
        $('.nnb-status').text('Чат не открыт');
        return;
    }
    const len = ctx().chat?.length ?? 0;
    const left = Math.max(0, (Number(s.interval) || 12) - (len - st.lastThinkAt));
    $('.nnb-status').text(s.enabled ? `До размышления: ${left} сообщ.` : 'Выключено');
}

async function askText(title, initial = '') {
    const c = ctx();
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) {
        const r = await c.callGenericPopup(title, c.POPUP_TYPE.INPUT, initial, { rows: 4 });
        return typeof r === 'string' ? r : null;
    }
    return window.prompt(title, initial);
}

function renderPanel() {
    const s = settings();
    $('.nnb-scope').toggleClass('nnb-spoiler', !!s.hideSpoilers);
    const list = $('#nnb_list').empty();
    const extra = $('#nnb_extra_list').empty();
    const st = store();
    if (!busy) setStatus('');
    if (!st) { closeBook(); return; }
    bookTabs();

    list.append($('<div class="nnb-subhead"></div>').text(`🪶 Задумки (${st.notes.length})`));
    if (!st.notes.length) {
        list.append('<div class="nnb-empty">Пока пусто. Модель сама начнёт записывать задумки, или нажми 🪶 вверху, чтобы подумать сейчас.</div>');
    }
    const len = ctx().chat?.length ?? 0;

    for (const n of st.notes) {
        const row = $(`
          <div class="nnb-note">
            <div class="nnb-meta"></div>
            <div class="nnb-text"></div>
            <div class="nnb-actions">
              <i class="fa-solid fa-dice" title="Реролл: придумать другую"></i>
              <i class="fa-solid fa-check" title="Выполнено"></i>
              <i class="fa-solid fa-pen" title="Изменить"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        row.find('.nnb-meta').text(`#${n.id}${n.tag ? ` · ${n.tag}` : ''} · ${Math.max(0, len - n.at)} сообщ. назад${n.ff ? ' · ⏩ в работе' : ''}`);
        row.find('.nnb-text').text(n.text);
        row.find('.fa-dice').on('click', () => rerollNote(n.id));
        row.find('.fa-check').on('click', () => closeNote(n.id, 'done'));
        row.find('.fa-trash').on('click', () => closeNote(n.id, 'deleted'));
        row.find('.fa-pen').on('click', async () => {
            const t = await askText('Изменить запись', n.text);
            if (t && t.trim()) {
                n.text = t.trim();
                await commit();
            }
        });
        list.append(row);
    }

    safeRender('гардероб', renderWardrobe, st);
    safeRender('шкатулка', renderBox, st);
    safeRender('карта', renderMap, st);
    safeRender('альбом', renderAlbum, st);
    safeRender('время', renderTime, st);
    safeRender('тайны', renderIntrigues, st, len);
    safeRender('NPC', renderNpcs, st);
    safeRender('развитие', renderArcs, st);

    if (st.archive.length) {
        const det = $('<details><summary></summary><div></div></details>');
        det.find('summary').text(`Архив (${st.archive.length})`);
        const box = det.find('div');
        for (const n of [...st.archive].reverse()) {
            const mark = n.status === 'done' ? '✓' : '✗';
            const num = n.kind === 'intrigue' ? `🔒T${n.id}` : `#${n.id}`;
            box.append($('<div class="nnb-note nnb-archived"><div class="nnb-text"></div></div>')
                .find('.nnb-text').text(`${mark} ${num}${n.tag ? ` [${n.tag}]` : ''} ${n.text}`).end());
        }
        extra.append(det);
    }

    if (st.rejected.length) {
        const det = $('<details><summary></summary><div></div><div class="menu_button">Забыть отклонённые</div></details>');
        det.find('summary').text(`Отклонённые идеи (${st.rejected.length})`);
        for (const t of [...st.rejected].reverse()) {
            det.find('div').first().append($('<div class="nnb-note nnb-archived"><div class="nnb-text"></div></div>').find('.nnb-text').text(t).end());
        }
        det.find('.menu_button').on('click', async () => { st.rejected = []; await commit(); });
        extra.append(det);
    }

    if (st.lastRaw !== undefined && (st.lastRaw || st.lastThinkAt)) {
        const det = $('<details><summary>Последний ответ модели</summary><pre class="nnb-raw"></pre></details>');
        det.find('pre').text(st.lastRaw || '(пустой ответ)');
        extra.append(det);
    }
}

let dirSaveTimer = null;
function saveDirectionSoon() {
    clearTimeout(dirSaveTimer);
    dirSaveTimer = setTimeout(() => ctx().saveMetadata(), 800);
}

function renderDirection() {
    const st = store();
    const box = $('#nnb_genres').empty();
    const enabled = !!st;
    for (const g of GENRES) {
        const lbl = $('<label class="checkbox_label nnb-chip"><input type="checkbox"><span></span></label>');
        lbl.find('span').text(g);
        const cb = lbl.find('input').prop('checked', !!st?.direction.genres.includes(g)).prop('disabled', !enabled);
        cb.on('change', () => {
            const s2 = store();
            if (!s2) return;
            const set = new Set(s2.direction.genres);
            cb.prop('checked') ? set.add(g) : set.delete(g);
            s2.direction.genres = GENRES.filter(x => set.has(x));
            saveDirectionSoon();
        });
        box.append(lbl);
    }
    $('#nnb_custom_genre').val(st?.direction.customGenre ?? '').prop('disabled', !enabled);
    $('#nnb_mix').val(st?.direction.mixMode ?? 'and').prop('disabled', !enabled);
    $('#nnb_intrigues_on').prop('checked', !!st?.direction.intrigues).prop('disabled', !enabled);
    $('#nnb_npcs_on').prop('checked', !!st?.direction.npcs).prop('disabled', !enabled);
    $('#nnb_arcs_on').prop('checked', !!st?.direction.arcs).prop('disabled', !enabled);
    $('#nnb_time_on').prop('checked', !!st?.direction.time).prop('disabled', !enabled);
    $('#nnb_lines').val(st?.direction.lines ?? '').prop('disabled', !enabled);
    $('#nnb_wardrobe_on').prop('checked', !!st?.direction.wardrobe).prop('disabled', !enabled);
    $('#nnb_gacha_on').prop('checked', !!st?.direction.gacha).prop('disabled', !enabled);
    $('#nnb_map_on').prop('checked', !!st?.direction.map).prop('disabled', !enabled);
    $('#nnb_living_world_on').prop('checked', st ? st.direction.livingWorld !== false : false).prop('disabled', !enabled);
}

function renderIntrigues(st, len) {
    let box = $('#nnb_intrigue_list').empty();
    if (!st.direction.intrigues) return;
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`🔒 Тайны и интриги (${st.intrigues.length})`);
    box.append(det);
    box = det;
    const addBtn = $('<div class="menu_button"><i class="fa-solid fa-plus"></i> Добавить тайну</div>');
    addBtn.on('click', async () => {
        const t = await askText('Новая тайна, слух или интрига — в чём правда на самом деле (можно начать с [тег], например [слух])');
        if (!t || !t.trim()) return;
        const m = t.trim().match(/^\[([^\]]{1,40})\]\s*([\s\S]+)$/);
        st.intrigues.push({ id: st.nextIntrigueId++, tag: m ? m[1] : '', text: (m ? m[2] : t).trim(), clues: [], at: ctx().chat.length });
        await commit();
    });
    if (!st.intrigues.length) {
        box.append('<div class="nnb-empty">Пока нет. Модель заведёт их при размышлении, или добавь сама.</div>');
        box.append(addBtn);
        return;
    }
    for (const it of st.intrigues) {
        const row = $(`
          <div class="nnb-note nnb-intrigue">
            <div class="nnb-meta"></div>
            <div class="nnb-text"></div>
            <div class="nnb-clues nnb-text"></div>
            <div class="nnb-actions">
              <i class="fa-solid fa-dice" title="Реролл: придумать другую"></i>
              <i class="fa-solid fa-check" title="Раскрыта"></i>
              <i class="fa-solid fa-pen" title="Изменить"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        row.find('.nnb-meta').text(`T${it.id}${it.tag ? ` · ${it.tag}` : ''} · улик: ${it.clues.length} · ${Math.max(0, len - it.at)} сообщ. назад`);
        row.find('.nnb-text').first().text(it.text);
        const clues = row.find('.nnb-clues');
        if (it.clues.length) clues.text('Открылось: ' + it.clues.map(c => c.text).join('; '));
        else clues.remove();
        row.find('.fa-dice').on('click', () => rerollNote(it.id, 'intrigue'));
        row.find('.fa-check').on('click', () => closeIntrigue(it.id, 'done'));
        row.find('.fa-trash').on('click', () => closeIntrigue(it.id, 'deleted'));
        row.find('.fa-pen').on('click', async () => {
            const t = await askText('Изменить тайну', it.text);
            if (t && t.trim()) {
                it.text = t.trim();
                await commit();
            }
        });
        box.append(row);
    }
    box.append(addBtn);
}


async function promptNpcAvatar(n) {
    const st = store();
    if (!st || !n) return;
    const el = $('<div class="nnb-pop"></div>');
    el.append($('<h3></h3>').text(`🖼 Внешность: ${n.name}`));
    el.append($('<div class="nnb-pop-sub"></div>').text('Картинка-референс лица для сцен (🎬). Когда этот персонаж будет в кадре, генератор возьмёт её как образец внешности.'));

    if (n.avatar) {
        const preview = $('<div style="display:flex; justify-content:center; margin:12px 0;"></div>');
        preview.append($('<img alt="" style="max-width:180px; max-height:180px; border-radius:12px; object-fit:cover; border:2px solid var(--SmartThemeQuoteColor, #8b78c4); box-shadow:0 4px 12px rgba(0,0,0,0.3);">').attr('src', n.avatar));
        el.append(preview);
    }

    const fileInput = $('<input type="file" accept="image/*" style="display:none">');
    const uploadBtn = $('<div class="menu_button"><i class="fa-solid fa-upload"></i> Загрузить с устройства</div>');
    uploadBtn.on('click', () => fileInput.trigger('click'));

    fileInput.on('change', async function() {
        const file = this.files?.[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
            toastr.warning('Файл слишком большой (максимум 8 МБ)', 'Внешность NPC');
            return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
            const dataUrl = String(reader.result || '');
            if (dataUrl) {
                const savedPath = await storeImage(dataUrl);
                n.avatar = savedPath;
                closePopupOf(el);
                await commit();
                toastr.success(`Референс внешности для «${escapeHtml(n.name)}» сохранён!`, '👥 NPC', { escapeHtml: false });
            }
        };
        reader.readAsDataURL(file);
    });

    el.append(fileInput);

    const urlRow = $('<div class="nnb-pop-row" style="margin-top:12px;"><input type="text" class="text_pole" placeholder="Или прямая ссылка на картинку (https://…)" style="flex:1;"><div class="menu_button"><i class="fa-solid fa-link"></i> Ок</div></div>');
    if (n.avatar && !n.avatar.startsWith('data:')) urlRow.find('input').val(n.avatar);
    urlRow.find('.menu_button').on('click', async () => {
        const url = urlRow.find('input').val().trim();
        if (!url) return;
        n.avatar = url;
        closePopupOf(el);
        await commit();
        toastr.success(`Ссылка на внешность для «${escapeHtml(n.name)}» сохранена!`, '👥 NPC', { escapeHtml: false });
    });

    const actRow = $('<div class="nnb-pop-row nnb-pop-links" style="margin-top:14px;"></div>');
    actRow.append(uploadBtn);
    if (n.avatar) {
        const removeBtn = $('<div class="menu_button"><i class="fa-solid fa-trash"></i> Удалить референс</div>');
        removeBtn.on('click', async () => {
            delete n.avatar;
            closePopupOf(el);
            await commit();
            toastr.info(`Референс для «${escapeHtml(n.name)}» удалён`, '👥 NPC', { escapeHtml: false });
        });
        actRow.append(removeBtn);
    }
    el.append(urlRow, actRow);

    await openPopup(el);
}

function renderNpcs(st) {
    const root = $('#nnb_npc_list').empty();
    if (!st.direction.npcs) return;
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`👥 NPC (${st.npcs.length})`);
    root.append(det);
    if (!st.npcs.length) {
        det.append('<div class="nnb-empty">Пока нет. Модель заведёт карточки при размышлении, или добавь сама.</div>');
    }
    const sortedNpcs = [...st.npcs].sort((a, b) => (!!b.favorite - !!a.favorite) || a.id - b.id);
    for (const n of sortedNpcs) {
        const row = $(`
          <div class="nnb-note nnb-npc">
            <div class="nnb-npc-header" style="display:flex; flex-direction:row; align-items:flex-start; gap:10px;">
              <div class="nnb-npc-details" style="flex:1; min-width:0;">
                <div class="nnb-meta"></div>
                <div class="nnb-npc-text"></div>
                <div class="nnb-npc-status"></div>
              </div>
            </div>
            <div class="nnb-actions">
              <i class="fa-solid fa-heart nnb-npc-fav-btn" title="Сделать главным героем / фаворитом"></i>
              <i class="fa-solid nnb-lock"></i>
              <i class="fa-solid fa-image nnb-npc-avatar-btn" title="Внешность (картинка-референс)"></i>
              <i class="fa-solid fa-pen" title="Изменить карточку"></i>
              <i class="fa-solid fa-comment-dots" title="Изменить состояние"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        if (n.avatar) {
            const av = $('<img class="nnb-npc-avatar" alt="">').attr('src', n.avatar).attr('title', `Внешность ${n.name} (нажми, чтобы изменить)`);
            av.css({
                'width': '46px',
                'height': '46px',
                'border-radius': '10px',
                'object-fit': 'cover',
                'flex-shrink': '0',
                'cursor': 'pointer',
                'border': '1.5px solid var(--SmartThemeQuoteColor, #8b78c4)',
                'margin-top': '2px'
            });
            av.on('click', () => promptNpcAvatar(n));
            row.find('.nnb-npc-header').prepend(av);
        }
        row.find('.nnb-npc-fav-btn')
            .css(n.favorite ? { color: '#ff6b8b', opacity: 1 } : { opacity: 0.45 })
            .attr('title', n.favorite ? 'Убрать из главных героев / фаворитов' : '❤️ Сделать главным героем / романтическим фаворитом (повышенный приоритет в сюжете, поездках и гардеробе)')
            .on('click', async () => {
                n.favorite = !n.favorite;
                await commit();
                toastr.info(n.favorite ? `❤️ «${escapeHtml(n.name)}» теперь главный герой / фаворит истории!` : `«${escapeHtml(n.name)}» больше не отмечен как главный фаворит`, '👥 Герои', { escapeHtml: false });
            });
        row.find('.nnb-npc-avatar-btn')
            .css(n.avatar ? { color: 'var(--SmartThemeQuoteColor, #8b78c4)' } : {})
            .attr('title', n.avatar ? 'Изменить/удалить референс внешности' : 'Задать референс внешности (картинку)')
            .on('click', () => promptNpcAvatar(n));
        if (n.favorite) row.css('border-color', '#ff6b8b');
        row.find('.nnb-meta').text((n.favorite ? '❤️ ' : '') + n.name + (n.favorite ? ' · Фаворит' : '') + (n.locked ? ' · правлено вручную' : '') + (n.avatar ? ' · 🖼 реф' : ''));
        row.find('.nnb-npc-text').text(n.card);
        if (n.status) row.find('.nnb-npc-status').text('Сейчас: ' + n.status);
        else row.find('.nnb-npc-status').remove();
        const rels = (st.relationships || []).filter(r => normName(r.a) === normName(n.name) || normName(r.b) === normName(n.name));
        if (rels.length) {
            const relTexts = rels.map(r => {
                const other = normName(r.a) === normName(n.name) ? r.b : r.a;
                const arr = r.arrow === '→' ? (normName(r.a) === normName(n.name) ? '→' : '←') : '↔';
                return `${arr} ${other}${r.type ? ` (${r.type})` : ''}`;
            });
            row.append($('<div class="nnb-npc-status nnb-rel-chips"></div>').text('Связи: ' + relTexts.join(' · ')));
        }
        const gifts = (st.wardrobe?.box || []).filter(x => normName(x.giftedTo) === normName(n.name));
        if (gifts.length) {
            row.append($('<div class="nnb-npc-status nnb-gift-chips"></div>').text('🎁 Подарки от игрока: ' + gifts.map(g => `«${g.title}»`).join(', ')));
        }
        row.find('.nnb-lock')
            .addClass(n.locked ? 'fa-lock' : 'fa-lock-open')
            .attr('title', n.locked ? 'Карточка защищена от модели (нажми, чтобы снять)' : 'Защитить карточку от изменений модели')
            .on('click', async () => { n.locked = !n.locked; await commit(); });
        row.find('.fa-pen').on('click', async () => {
            const name = await askText('Имя NPC', n.name);
            if (name === null) return;
            const t = await askText(`Карточка: ${name || n.name}`, n.card);
            if (t === null) return;
            if (name.trim()) n.name = name.trim();
            if (t.trim()) n.card = t.trim();
            n.locked = true;
            await commit();
        });
        row.find('.fa-comment-dots').on('click', async () => {
            const t = await askText(`Что с ${n.name} сейчас`, n.status);
            if (t === null) return;
            n.status = t.trim();
            await commit();
        });
        row.find('.fa-trash').on('click', async () => {
            if (!confirm(`Удалить карточку «${n.name}»?`)) return;
            st.npcs = st.npcs.filter(x => x.id !== n.id);
            await commit();
        });
        det.append(row);
    }
    const add = $('<div class="menu_button"><i class="fa-solid fa-user-plus"></i> Добавить NPC</div>');
    add.on('click', async () => {
        const name = await askText('Имя NPC');
        if (!name || !name.trim()) return;
        if (findNpc(st, name)) return toastr.warning('Такой NPC уже есть', 'Блокнот рассказчика');
        const card = await askText(`Кто такой ${name.trim()}? Внешность, характер, отношение к твоему персонажу`);
        if (!card || !card.trim()) return;
        st.npcs.push({ id: st.nextNpcId++, name: name.trim(), card: card.trim(), status: '', locked: true, at: ctx().chat.length });
        await commit();
    });
    det.append(add);

    // --- Матрица отношений между персонажами ---
    if (!st.relationships) st.relationships = [];
    const relDet = $('<details open class="nnb-section"><summary></summary></details>');
    relDet.find('summary').text(`💞 Отношения и связи (${st.relationships.length})`);
    if (!st.relationships.length) {
        relDet.append('<div class="nnb-empty">Пока нет зафиксированных связей. Модель запишет их при размышлении, или добавь вручную.</div>');
    }
    for (const r of st.relationships) {
        const row = $(`
          <div class="nnb-note nnb-rel">
            <div class="nnb-meta">
              <span class="nnb-rel-who"></span>
              <span class="nnb-rel-type"></span>
              <span class="nnb-rel-lock-tag"></span>
            </div>
            <div class="nnb-npc-text"></div>
            <div class="nnb-actions">
              <i class="fa-solid nnb-lock"></i>
              <i class="fa-solid fa-arrows-rotate" title="Сменить направление (взаимно ↔ / односторонне →)"></i>
              <i class="fa-solid fa-pen" title="Изменить связь"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        const arrow = r.arrow || '↔';
        row.find('.nnb-rel-who').text(`${r.a} ${arrow} ${r.b}`);
        row.find('.nnb-rel-type').text(r.type ? `[${r.type}]` : '');
        if (r.locked) row.find('.nnb-rel-lock-tag').text(' · защищено');
        row.find('.nnb-npc-text').text(r.desc || '');
        row.find('.nnb-lock')
            .addClass(r.locked ? 'fa-lock' : 'fa-lock-open')
            .attr('title', r.locked ? 'Связь защищена от модели (нажми, чтобы снять)' : 'Защитить связь от изменений модели')
            .on('click', async () => { r.locked = !r.locked; await commit(); });
        row.find('.fa-arrows-rotate').on('click', async () => {
            r.arrow = r.arrow === '→' ? '↔' : '→';
            await commit();
        });
        row.find('.fa-pen').on('click', async () => {
            const who = await askText('Персонажи (например «Лилия ↔ Кайлар» или «Марк → София»)', `${r.a} ${r.arrow || '↔'} ${r.b}`);
            if (who === null) return;
            const tp = await askText('Тип связи (дружба, роман, соперничество, родство, подозрение)', r.type || '');
            if (tp === null) return;
            const ds = await askText('Суть отношений / что между ними', r.desc || '');
            if (ds === null) return;
            const wm = who.match(/^(.+?)\s*(↔|<->|->|→|\+)\s*(.+)$/);
            if (wm) {
                r.a = wm[1].trim();
                r.arrow = (wm[2] === '->' || wm[2] === '→') ? '→' : '↔';
                r.b = wm[3].trim();
            }
            r.type = tp.trim();
            r.desc = ds.trim();
            r.locked = true;
            await commit();
        });
        row.find('.fa-trash').on('click', async () => {
            st.relationships = st.relationships.filter(x => x.id !== r.id);
            await commit();
        });
        relDet.append(row);
    }
    const addRel = $('<div class="menu_button"><i class="fa-solid fa-heart-circle-plus"></i> Добавить связь</div>');
    addRel.on('click', async () => {
        const who = await askText('Персонажи (например «Лилия ↔ Кайлар» или «Марк → София»)');
        if (!who || !who.trim()) return;
        const wm = who.match(/^(.+?)\s*(↔|<->|->|→|\+)\s*(.+)$/);
        const a = wm ? wm[1].trim() : who.trim();
        const arrow = (wm && (wm[2] === '->' || wm[2] === '→')) ? '→' : '↔';
        const b = wm ? wm[3].trim() : '';
        if (!b) return toastr.warning('Укажи двух персонажей через ↔ или → (например «Алиса ↔ Боб»)', 'Блокнот рассказчика');
        const tp = await askText('Тип связи (дружба, роман, соперничество, семья, подозрение)', 'дружба');
        if (tp === null) return;
        const ds = await askText('Суть отношений / что между ними');
        if (ds === null) return;
        st.relationships.push({ id: st.nextRelId++, a, b, arrow, type: tp.trim(), desc: ds.trim(), locked: true, at: ctx().chat.length });
        await commit();
    });
    relDet.append(addRel);
    root.append(relDet);
}

function renderArcs(st) {
    const root = $('#nnb_arc_list').empty();
    if (!st.direction.arcs) return;
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`🌱 Развитие (${st.arcs.length})`);
    root.append(det);
    if (!st.arcs.length && !st.evolved.length) {
        det.append('<div class="nnb-empty">Пока нет арок. Модель заведёт их, когда в истории появится почва для изменений, или добавь сама.</div>');
    }
    const need = Math.max(1, Number(settings().minStimuli) || 2);
    for (const a of st.arcs) {
        const row = $(`
          <div class="nnb-note nnb-arc">
            <div class="nnb-meta"></div>
            <div class="nnb-npc-text nnb-arc-title"></div>
            <div class="nnb-stage"></div>
            <div class="nnb-npc-status nnb-arc-current"></div>
            <div class="nnb-npc-status nnb-arc-stim"></div>
            <div class="nnb-actions">
              <i class="fa-solid fa-arrow-down" title="Откатить стадию"></i>
              <i class="fa-solid fa-arrow-up" title="Следующая стадия"></i>
              <i class="fa-solid fa-pen" title="Изменить"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        row.find('.nnb-meta').text(`A${a.id} · ${a.who} · стимулов ${a.sinceShift}/${need}`);
        row.find('.nnb-arc-title').text(a.text);
        row.find('.nnb-stage').text('●'.repeat(a.stage) + '○'.repeat(ARC_MAX - a.stage) + '  ' + ARC_STAGES[a.stage].name);
        if (a.current) row.find('.nnb-arc-current').text('Сейчас: ' + a.current); else row.find('.nnb-arc-current').remove();
        if (a.stimuli.length) row.find('.nnb-arc-stim').text('Стимулы: ' + a.stimuli.map(x => x.text).join('; ')); else row.find('.nnb-arc-stim').remove();
        row.find('.fa-arrow-down').on('click', async () => { a.stage = Math.max(1, a.stage - 1); a.sinceShift = 0; await commit(); });
        row.find('.fa-arrow-up').on('click', async () => {
            a.stage++;
            a.sinceShift = 0;
            if (a.stage >= ARC_MAX) {
                st.evolved.push({ who: a.who, text: `${a.text}${a.current ? ` — ${a.current}` : ''}`, at: ctx().chat.length });
                st.arcs = st.arcs.filter(x => x !== a);
            }
            await commit();
        });
        row.find('.fa-pen').on('click', async () => {
            const t = await askText(`Арка ${a.who}: что → во что`, a.text);
            if (t === null) return;
            const c = await askText('Как характер проявляется сейчас', a.current);
            if (c === null) return;
            if (t.trim()) a.text = t.trim();
            a.current = c.trim();
            await commit();
        });
        row.find('.fa-trash').on('click', async () => {
            if (!confirm(`Удалить арку «${a.text}»?`)) return;
            st.arcs = st.arcs.filter(x => x !== a);
            await commit();
        });
        det.append(row);
    }
    if (st.evolved.length) {
        det.append('<div class="nnb-subhead">🌳 Закреплённые изменения</div>');
        st.evolved.forEach((e, i) => {
            const row = $('<div class="nnb-note nnb-arc"><div class="nnb-npc-text"></div><div class="nnb-actions"><i class="fa-solid fa-pen" title="Изменить"></i><i class="fa-solid fa-trash" title="Удалить"></i></div></div>');
            row.find('.nnb-npc-text').text(`${e.who}: ${e.text}`);
            row.find('.fa-pen').on('click', async () => {
                const t = await askText(`Изменение: ${e.who}`, e.text);
                if (t && t.trim()) { e.text = t.trim(); await commit(); }
            });
            row.find('.fa-trash').on('click', async () => {
                if (!confirm('Удалить это изменение? Персонаж вернётся к поведению из карточки в этой части.')) return;
                st.evolved.splice(i, 1);
                await commit();
            });
            det.append(row);
        });
    }
    const add = $('<div class="menu_button"><i class="fa-solid fa-seedling"></i> Добавить арку</div>');
    add.on('click', async () => {
        const who = await askText('Чей характер будет меняться?');
        if (!who || !who.trim()) return;
        const t = await askText('Что сейчас → во что может развиться (например «лень → ответственность»)');
        if (!t || !t.trim()) return;
        st.arcs.push({ id: st.nextArcId++, who: who.trim(), text: t.trim(), stage: 1, current: '', stimuli: [], sinceShift: 0, at: ctx().chat.length });
        await commit();
    });
    det.append(add);
}


function handleDateRollback(st, oldDate, newDate) {
    if (!st || !newDate || !oldDate || newDate >= oldDate) return;
    ensureHolidayState(st);

    const reopened = [];
    const keysToDelete = [];
    for (const key of Object.keys(st.holidayDone || {})) {
        const [name, start] = key.split('|');
        if (!start) continue;
        const holInfo = holidaysFor(st).find(h => h.name === name);
        const y = Number(start.slice(0, 4));
        const occ = holInfo ? occurrences(holInfo, y) : { start, end: start };
        const end = occ ? occ.end : start;

        if (end >= newDate) {
            keysToDelete.push(key);
            reopened.push(name);
            st.medals = (st.medals || []).filter(m => !(m.holiday === name && m.tier === 'anti'));
            if (Array.isArray(st.time.timeline)) {
                st.time.timeline = st.time.timeline.filter(e => !(e.text.startsWith(name + ':') && e.text.includes('антимедаль')));
            }
            st.traces = (st.traces || []).filter(tr => !tr.text.includes(name));
            st.memories = (st.memories || []).filter(mem => !mem.text.startsWith(name));
        }
    }
    keysToDelete.forEach(k => delete st.holidayDone[k]);

    if (st.holiday) {
        if (st.holiday.finished || (reopened.length && st.holiday.start > newDate)) {
            st.holiday = null;
        }
    }

    if (reopened.length) {
        toastr.info(`Время отмотано назад: праздник «${reopened.join(', ')}» снова доступен, антимедаль снята!`, '📅 Календарь');
    }
}

function removeMedal(st, m) {
    if (!st || !m) return;
    ensureHolidayState(st);
    st.medals = (st.medals || []).filter(x => x !== m);
    for (const key of Object.keys(st.holidayDone || {})) {
        if (key.startsWith(m.holiday + '|')) {
            delete st.holidayDone[key];
        }
    }
    if (Array.isArray(st.time.timeline)) {
        st.time.timeline = st.time.timeline.filter(e => !e.text.includes(`медаль «${m.title}»`) && !(e.text.startsWith(m.holiday + ':') && e.date === m.date));
    }
    st.memories = (st.memories || []).filter(mem => !mem.text.startsWith(m.holiday));
    st.traces = (st.traces || []).filter(tr => !tr.text.includes(m.holiday));
    if (st.holiday && (st.holiday.name === m.holiday || st.holiday.finished)) {
        st.holiday = null;
    }
}

function renderTime(st) {
    const root = $('#nnb_time_box').empty();
    if (!st.direction.time) return;
    const t = st.time;
    const det = $('<details open class="nnb-section"><summary>📅 Время и место</summary></details>');
    root.append(det);

    renderHolidayCard(st, det);
    const head = $('<div class="nnb-time-now"></div>');
    if (t.date) {
        const s = season(t.date);
        head.text(`${weekday(t.date)}, ${formatDate(t.date)} · ${s.name}, ${s.phase}`);
    } else {
        head.text('Дата не задана — модель определит её при размышлении, или задай сама.');
    }
    det.append(head);

    const dateRow = $(`<div class="nnb-row nnb-time-row">
        <input type="date" class="text_pole nnb-date">
        <div class="menu_button nnb-shift" data-d="-1">−1 д</div>
        <div class="menu_button nnb-shift" data-d="1">+1 д</div>
        <div class="menu_button nnb-shift" data-d="7">+1 нед</div>
        <div class="menu_button nnb-shift" data-m="1">+1 мес</div>
      </div>`);
    dateRow.find('.nnb-date').val(t.date).on('change', async function () {
        const v = $(this).val();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            const oldDate = t.date;
            t.date = v;
            if (oldDate && v < oldDate) handleDateRollback(st, oldDate, v);
            await commit();
            runHolidayStep();
        }
    });
    dateRow.find('.nnb-shift').on('click', async function () {
        const base = t.date || toIso(new Date());
        const d = Number($(this).data('d') || 0), mo = Number($(this).data('m') || 0);
        const oldDate = t.date;
        t.date = mo ? addMonths(base, mo) : addDays(base, d);
        if (oldDate && t.date < oldDate) handleDateRollback(st, oldDate, t.date);
        await commit();
        runHolidayStep();
    });
    det.append(dateRow);

    const placeRow = $(`<div class="nnb-row nnb-time-row">
        <select class="text_pole nnb-country nnb-wide">
          <option value="">Страна не задана</option>
          <option value="UK">Великобритания</option>
          <option value="US">США</option>
          <option value="JP">Япония</option>
          <option value="RU">Россия</option>
          <option value="other">Другая…</option>
        </select>
        <input type="text" class="text_pole nnb-city" placeholder="Город">
      </div>`);
    const other = $('<input type="text" class="text_pole nnb-country-name" placeholder="Название страны">');
    const sel = placeRow.find('.nnb-country');
    sel.val(t.country || (t.countryName ? 'other' : ''));
    other.val(t.countryName).toggle(!t.country && !!t.countryName);
    const placeChanged = async () => {
        if (!t.flavorLocked) t.flavor = '';
        await commit();
        if (placeLine(st) && !t.flavor) runFlavor();
    };
    sel.on('change', async function () {
        const v = $(this).val();
        if (v === 'other') { t.country = ''; other.show().trigger('focus'); return; }
        t.country = v;
        t.countryName = '';
        await placeChanged();
    });
    other.on('change', async function () { t.country = ''; t.countryName = $(this).val().trim(); await placeChanged(); });
    placeRow.find('.nnb-city').val(t.city).on('change', async function () { t.city = $(this).val().trim(); await commit(); });
    det.append(placeRow, other);

    const flavor = $('<textarea class="text_pole nnb-insp" rows="3" placeholder="Местный колорит: еда, деньги, транспорт, климат, привычки. Если оставить пустым, модель заполнит сама, когда известна страна."></textarea>');
    flavor.val(t.flavor).on('change', async function () {
        t.flavor = $(this).val().trim();
        t.flavorLocked = !!t.flavor;
        await commit();
    });
    det.append(flavor);
    const genFlavor = $('<div class="menu_button"><i class="fa-solid fa-compass"></i> Сгенерировать колорит</div>');
    genFlavor.on('click', () => {
        if (!placeLine(st)) return toastr.warning('Сначала укажи страну или город', 'Блокнот рассказчика');
        runFlavor();
    });
    det.append(genFlavor);

    if (t.date) {
        const up = upcoming(st, 60);
        det.append('<div class="nnb-subhead">Ближайшие праздники и события</div>');
        if (!up.length) det.append('<div class="nnb-empty">В ближайшие два месяца ничего нет.</div>');
        for (const h of up) {
            const key = h.name + '|' + h.start;
            const isDone = !!st.holidayDone[key];
            const row = $('<div class="nnb-task-row" style="margin: 3px 0; justify-content: space-between; align-items: center;"></div>');
            const when = h.ongoing ? 'идёт сейчас' : h.inDays === 0 ? 'сегодня' : `через ${daysWord(h.inDays)}`;
            const statusText = isDone ? (st.holidayDone[key] === 'cancelled' ? ' · отменён' : ' · ✓ пройден') : '';
            const label = $('<div class="nnb-npc-status" style="margin: 0; flex: 1;"></div>').text(`${formatDate(h.start, false)} — ${h.name} (${when})${statusText}`);
            row.append(label);
            const act = $('<div class="nnb-actions"></div>');
            if (isDone) {
                const rst = $('<i class="fa-solid fa-rotate-left" title="Сбросить статус и запустить праздник снова"></i>');
                rst.on('click', async () => {
                    if (!confirm(`Сбросить праздник «${h.name}» и запустить его снова?`)) return;
                    delete st.holidayDone[key];
                    st.medals = (st.medals || []).filter(m => !(m.holiday === h.name && m.tier === 'anti'));
                    if (st.holiday && (st.holiday.name === h.name || st.holiday.finished)) st.holiday = null;
                    await commit();
                    runHolidayStep();
                    toastr.success(`Праздник «${h.name}» сброшен и снова активен!`, '📅 Праздники');
                });
                act.append(rst);
            } else {
                const del = $('<i class="fa-solid fa-ban" title="Пропустить / отменить это событие"></i>');
                del.on('click', async () => {
                    if (!confirm(`Отменить событие «${h.name}»? Оно не будет запускаться.`)) return;
                    st.holidayDone[key] = 'cancelled';
                    if (st.holiday && st.holiday.name === h.name) st.holiday = null;
                    if (h.custom || h.bday) {
                        st.time.custom = (st.time.custom || []).filter(c => c.name !== h.name && ('День рождения: ' + c.who) !== h.name);
                    }
                    await commit();
                    render();
                    toastr.info(`Событие «${h.name}» отменено`, '📅 Праздники');
                });
                act.append(del);
            }
            row.append(act);
            det.append(row);
        }
    }

    if (t.custom.length) det.append('<div class="nnb-subhead">Свои даты</div>');
    t.custom.forEach((c, i) => {
        const row = $('<div class="nnb-note"><div class="nnb-npc-text"></div><div class="nnb-actions"><i class="fa-solid fa-trash" title="Удалить"></i></div></div>');
        const [mm, dd] = c.md.split('-').map(Number);
        row.find('.nnb-npc-text').text(`${dd} ${MONTHS_GEN[mm - 1]} — ${c.name}${c.note ? ` (${c.note})` : ''}`);
        row.find('.fa-trash').on('click', async () => {
            const deleted = t.custom[i];
            t.custom.splice(i, 1);
            if (st.holiday && (st.holiday.name === deleted.name || st.holiday.name === ('День рождения: ' + deleted.who))) {
                st.holiday = null;
                if (st.holiday && st.holiday.key) delete st.holidayDone[st.holiday.key];
            }
            await commit();
            render();
            toastr.info(`Дата «${deleted.name}» удалена`, '📅 Праздники');
        });
        det.append(row);
    });
    const add = $('<div class="menu_button"><i class="fa-solid fa-cake-candles"></i> Добавить свою дату</div>');
    add.on('click', async () => {
        const name = await askText('Что за дата? Например «День рождения Деку» или «Годовщина знакомства»');
        if (!name || !name.trim()) return;
        const when = await askText('Когда? Например «20 февраля» или «20.02»');
        if (!when) return;
        const iso = parseDateText(when, '2000-01-01');
        if (!iso) return toastr.warning('Не поняла дату. Напиши, например, «20 февраля» или «20.02».', 'Блокнот рассказчика');
        t.custom.push({ name: name.trim(), md: iso.slice(5) });
        await commit();
    });
    det.append(add);
    renderChronicleAndMedals(st, det);
}

async function cancelHoliday(st, hol) {
    if (!hol) return;
    if (st.holiday && (st.holiday.name === hol.name || st.holiday.key === hol.key)) {
        st.holiday = null;
    }
    if (hol.key) {
        st.holidayDone[hol.key] = 'cancelled';
    }
    if (st.time && st.time.custom) {
        const normHolName = normName(hol.name).replace(/^день рождения:\s*/i, '');
        st.time.custom = st.time.custom.filter(c => {
            const normC = normName(c.name).replace(/^день рождения:\s*/i, '');
            const normWho = normName(c.who || '');
            return normC !== normHolName && normWho !== normHolName;
        });
    }
    st.medals = (st.medals || []).filter(m => m.holiday !== hol.name);
    await commit();
    render();
}

function renderHolidayCard(st, det) {
    const hol = st.holiday;
    if (!settings().events || !hol || hol.finished || !st.time.date) return;
    const t = tierOf(hol);
    const box = $('<div class="nnb-note nnb-event"><div class="nnb-event-title" style="display:flex; justify-content:space-between; align-items:center;"></div><div class="nnb-meta"></div><div class="nnb-tasks"></div></div>');
    const titleText = $(`<span>${hol.emoji} ${hol.name} — ${whenText(hol, st.time.date)}</span>`);
    const titleTrash = $('<i class="fa-solid fa-trash" title="Отменить праздник" style="cursor:pointer; opacity:0.7; padding:2px 6px;"></i>');
    titleTrash.on('click', async () => {
        if (!confirm(`Отменить событие «${hol.name}»? Оно будет убрано без штрафов и антимедалей.`)) return;
        await cancelHoliday(st, hol);
        toastr.info(`Событие «${hol.name}» отменено`, '📅 Праздники');
    });
    box.find('.nnb-event-title').append(titleText, titleTrash);
    box.find('.nnb-meta').text(`Традиции: ${t.done} из ${t.total}${hol.tasks.some(x => x.hidden) ? ' · есть секретная задача' : ''}`);
    hol.tasks.forEach((x, i) => {
        const row = $('<div class="nnb-task-row"><label class="checkbox_label nnb-task"><input type="checkbox"><span></span></label><div class="nnb-actions"><i class="fa-solid fa-dice" title="Другая задача"></i><i class="fa-solid fa-pen" title="Изменить"></i></div></div>');
        row.find('span').text(x.hidden && !x.done ? '🔒 Секретная задача' : `${x.hidden ? '🔓 ' : ''}${x.text}`);
        row.find('input').prop('checked', !!x.done).on('change', async function () { x.done = $(this).prop('checked'); await commit(); });
        if (x.done) row.find('.nnb-actions').remove();
        if (x.hidden) row.find('.fa-pen').remove();
        row.find('.fa-dice').on('click', () => rerollHolidayTask(i));
        row.find('.fa-pen').on('click', async () => {
            const t = await askText('Изменить задачу', x.text);
            if (t && t.trim()) { x.text = t.trim(); await commit(); }
        });
        box.find('.nnb-tasks').append(row);
    });
    const btns = $('<div class="nnb-buttons" style="margin-top: 8px;"></div>');
    const fin = $('<div class="menu_button"><i class="fa-solid fa-flag-checkered"></i> Завершить праздник и получить медаль</div>');
    fin.on('click', () => runHolidayStep({ finish: true }));
    const rst = $('<div class="menu_button"><i class="fa-solid fa-rotate-left"></i> Начать заново</div>');
    rst.on('click', async () => {
        if (!confirm(`Начать праздник «${hol.name}» заново? Задачи будут перегенерированы.`)) return;
        delete st.holidayDone[hol.key];
        st.holiday = null;
        await commit();
        runHolidayStep();
    });
    const cancel = $('<div class="menu_button" style="color: var(--SmartThemeQuoteColor, #e57373);"><i class="fa-solid fa-trash"></i> Отменить событие</div>');
    cancel.on('click', async () => {
        if (!confirm(`Отменить событие «${hol.name}»? Оно будет убрано без штрафов и антимедалей.`)) return;
        await cancelHoliday(st, hol);
        toastr.info(`Событие «${hol.name}» отменено`, '📅 Праздники');
    });
    btns.append(fin, rst, cancel);
    box.append(btns);
    det.append(box);
}

function renderChronicleAndMedals(st, det) {
    const list = st.time.timeline || [];
    const chron = $('<details class="nnb-section"><summary></summary></details>');
    chron.find('summary').text(`📜 Хроника (${list.length})`);
    if (!list.length) chron.append('<div class="nnb-empty">Здесь будут важные события с датами — модель записывает их при размышлении.</div>');
    [...list].reverse().forEach(e => {
        const row = $('<div class="nnb-note"><div class="nnb-meta"></div><div class="nnb-npc-text"></div><div class="nnb-actions"><i class="fa-solid fa-trash" title="Удалить"></i></div></div>');
        row.find('.nnb-meta').text(formatDate(e.date) + (st.time.date ? ` · ${agoText(daysBetween(e.date, st.time.date))}` : ''));
        row.find('.nnb-npc-text').text(e.text);
        row.find('.fa-trash').on('click', async () => { list.splice(list.indexOf(e), 1); await commit(); });
        chron.append(row);
    });
    const add = $('<div class="menu_button"><i class="fa-solid fa-plus"></i> Добавить событие</div>');
    add.on('click', async () => {
        const text = await askText('Что произошло?');
        if (!text || !text.trim()) return;
        const when = await askText('Когда? Например «14 октября» или «14.10.2024». Пусто — сегодня по истории');
        if (when === null) return;
        let date = when.trim() ? parseDateText(when, '1900-01-01') : st.time.date;
        if (!date) return toastr.warning('Не поняла дату', 'Блокнот рассказчика');
        if (st.time.date && date > st.time.date && !/\d{4}/.test(when)) date = `${Number(st.time.date.slice(0, 4)) - 1}${date.slice(4)}`;
        addEvent(st, date, text);
        await commit();
    });
    chron.append(add);
    det.append(chron);

    if (!st.medals.length) return;
    const med = $('<details class="nnb-section"><summary></summary></details>');
    med.find('summary').text(`🏅 Витрина медалей (${st.medals.length})`);
    [...st.medals].reverse().forEach(m => {
        const row = $('<div class="nnb-note"><div class="nnb-npc-text"></div><div class="nnb-meta"></div><div class="nnb-npc-status"></div><div class="nnb-actions"><i class="fa-solid fa-trash" title="Удалить медаль"></i></div></div>');
        row.find('.nnb-npc-text').text(`${m.emoji || ''} «${m.title}»${m.secret ? ' ✨' : ''}`);
        row.find('.nnb-meta').text(`${TIER_ICONS[m.tier] || ''} ${TIER_NAMES[m.tier] || ''} · ${m.holiday} ${String(m.date || '').slice(0, 4)}`);
        row.find('.nnb-npc-status').text(m.desc);
        row.find('.fa-trash').on('click', async () => {
            if (!confirm(`Удалить медаль «${m.title}» (${m.holiday})? Если дата сейчас подходящая, праздник снова станет доступен.`)) return;
            removeMedal(st, m);
            await commit();
            runHolidayStep();
            toastr.info(`Медаль «${m.title}» удалена`, '🏅 Медали');
        });
        med.append(row);
    });
    det.append(med);
}

async function closeIntrigue(id, status) {
    const st = store();
    const i = st?.intrigues.findIndex(n => n.id === id) ?? -1;
    if (i < 0) return;
    const [it] = st.intrigues.splice(i, 1);
    if (status !== 'deleted') {
        Object.assign(it, { kind: 'intrigue', status, closedAt: ctx().chat.length });
        st.archive.push(it);
    }
    await commit();
}

async function closeNote(id, status) {
    const st = store();
    const i = st?.notes.findIndex(n => n.id === id) ?? -1;
    if (i < 0) return;
    const [n] = st.notes.splice(i, 1);
    if (status !== 'deleted') {
        n.status = status;
        n.closedAt = ctx().chat.length;
        st.archive.push(n);
    }
    await commit();
}

async function commit() {
    await ctx().saveMetadata();
    updateInjection();
    renderPanel();
}

function bind(id, key, kind = 'text') {
    const el = $(`#${id}`);
    const s = settings();
    if (kind === 'checkbox') {
        el.prop('checked', !!s[key]).on('change', () => {
            s[key] = el.prop('checked');
            saveSettings();
            updateInjection();
            renderPanel();
        });
    } else {
        el.val(s[key]).on('input change', () => {
            s[key] = kind === 'number' ? Number(el.val()) : el.val();
            saveSettings();
            updateInjection();
            if (kind === 'number') setStatus('');
        });
    }
}

function fillImageSources() {
    const sel = $('#nnb_img_src');
    if (!sel.length) return;
    const cur = settings().imageSource || '';
    sel.empty().append($('<option value=""></option>').text('Генерация картинок Таверны (Image Generation)'));
    for (const p of connectionProfiles()) sel.append($('<option></option>').val(p.id).text(`Профиль: ${p.name}`));
    sel.append($('<option value="openai-images"></option>').text('Картинки OpenAI по ключу (gpt-image)'));
    if (cur && cur !== 'openai-images' && !connectionProfiles().some(p => p.id === cur)) sel.append($('<option></option>').val(cur).text('(профиль удалён)'));
    sel.val(cur);
    $('#nnb_img_api').toggle(cur === 'openai-images');
}

// 🎬 и 👗 у сообщений: сцена — на каждом сообщении, гардероб — у последнего
function placeMesButtons() {
    const on = !!settings().enabled;
    const st = store();
    const mes = $('#chat .mes');
    if (!on || !st) { $('.nnb-mes-btn').remove(); return; }
    mes.each(function () {
        const box = $(this).find('.mes_buttons').first();
        if (box.length && !box.find('.nnb-mes-scene').length) {
            box.prepend('<div class="mes_button nnb-mes-btn nnb-mes-scene fa-solid fa-image interactable" title="Нарисовать эту сцену" tabindex="0"></div>');
        }
    });
    $('.nnb-mes-ward, .nnb-mes-gacha, .nnb-mes-map, .nnb-mes-actions-btn').remove();
    const lastMes = mes.last();
    const lastBox = lastMes.find('.mes_buttons').first();
    if (lastBox.length && mapOn(st)) lastBox.prepend('<div class="mes_button nnb-mes-btn nnb-mes-map fa-solid fa-map interactable" title="Карта: куда пойти" tabindex="0"></div>');
    if (lastBox.length && gachaOn(st)) lastBox.prepend('<div class="mes_button nnb-mes-btn nnb-mes-gacha fa-solid fa-dice interactable" title="Находки: испытать удачу" tabindex="0"></div>');
    if (lastBox.length && st.direction.wardrobe) lastBox.prepend('<div class="mes_button nnb-mes-btn nnb-mes-ward fa-solid fa-shirt interactable" title="Гардероб: подобрать образ" tabindex="0"></div>');
    if (lastBox.length && settings().actionPrompts && !lastMes.hasClass('is_user')) {
        const actBtn = $('<div class="mes_button nnb-mes-btn nnb-mes-actions-btn fa-solid fa-lightbulb interactable" title="💡 Подсказать варианты действий" tabindex="0"></div>');
        actBtn.on('click', function(e) {
            e.stopPropagation();
            generateActionPromptsNow();
        });
        lastBox.prepend(actBtn);
    }
    renderActionPrompts();
}
let mesBtnTimer = null;
function placeMesButtonsSoon() {
    clearTimeout(mesBtnTimer);
    mesBtnTimer = setTimeout(placeMesButtons, 150);
}

// ⏩ у поля ввода и пункты в меню «волшебной палочки»
function placeFfButton() {
    const on = !!settings().ffButton;
    let btn = $('#nnb_ff_btn');
    if (on && !btn.length && $('#send_but').length) {
        btn = $('<div id="nnb_ff_btn" class="fa-solid fa-forward interactable" title="Дальше: перейти к следующему событию" tabindex="0"></div>');
        btn.on('click', fastForward);
        $('#send_but').before(btn);
    }
    btn.toggle(on);
}

function addMenuItems() {
    const menu = $('#extensionsMenu');
    if (!menu.length || $('#nnb_menu_ff').length) return;
    const item = (id, icon, text, fn) => $(`<div id="${id}" class="list-group-item flex-container flexGap5 interactable" tabindex="0"><div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span></span></div>`)
        .find('span').text(text).end().on('click', fn);
    menu.append(item('nnb_menu_book', 'fa-book-open', 'Блокнот рассказчика', () => openBook()));
    menu.append(item('nnb_menu_world', 'fa-earth-americas', 'Создать мир (стартовый набор)', () => openWorldCreator()));
    menu.append(item('nnb_menu_ff', 'fa-forward', 'Дальше: следующее событие', fastForward));
    menu.append(item('nnb_menu_scene', 'fa-image', 'Сцена: нарисовать', () => showScenePopup()));
    menu.append(item('nnb_menu_map', 'fa-map', 'Карта: куда пойти', () => showMapPopup()));
    menu.append(item('nnb_menu_gacha', 'fa-dice', 'Находки: испытать удачу', () => startGacha()));
    menu.append(item('nnb_menu_album', 'fa-images', 'Альбом', () => openBook('album')));
    menu.append(item('nnb_menu_wardrobe', 'fa-shirt', 'Гардероб: подобрать образ', () => {
        const st = store();
        if (st && !st.direction.wardrobe) return toastr.info('Гардероб выключен в этом чате — включи его в блокноте, вкладка «Сюжет»', 'Блокнот рассказчика');
        startWardrobe();
    }));
}

jQuery(async () => {
    const c = ctx();
    if ($('#nnb_panel').length) {
        // уже загружена другая копия блокнота (обычная или бета) — не запускаемся дважды
        toastr.warning('Включены две версии «Блокнота рассказчика». Оставь одну: выключи другую в Manage extensions и перезагрузи страницу.', 'Блокнот рассказчика', { timeOut: 15000 });
        return;
    }
    $('#extensions_settings2').append(PANEL_HTML);
    $('body').append(BOOK_HTML);
    $('#nnb_open_book').on('click', () => { try { openBook(); } catch (e) { console.error('[npc_notebook] open', e); toastr.error(escapeHtml(e?.message || e), 'Блокнот не открылся', { escapeHtml: false }); } });
    bindBook();
    $(document).on('keydown', e => { if (e.key === 'Escape' && $('#nnb_book').is(':visible') && !$('dialog[open]').length) closeBook(); });

    bind('nnb_enabled', 'enabled', 'checkbox');
    bind('nnb_toasts', 'showToasts', 'checkbox');
    bind('nnb_spoilers', 'hideSpoilers', 'checkbox');
    bind('nnb_ff_on', 'ffButton', 'checkbox');
    $(document).on('click', '.nnb-mes-scene', function (e) {
        e.stopPropagation();
        const id = Number($(this).closest('.mes').attr('mesid'));
        showScenePopup(Number.isInteger(id) ? id : undefined);
    });
    $(document).on('click', '.nnb-mes-ward', function (e) {
        e.stopPropagation();
        startWardrobe();
    });
    $(document).on('click', '.nnb-mes-map', function (e) {
        e.stopPropagation();
        showMapPopup();
    });
    $(document).on('click', '.nnb-mes-gacha', function (e) {
        e.stopPropagation();
        startGacha();
    });
    try {
        const chatEl = document.getElementById('chat');
        if (chatEl) new MutationObserver(placeMesButtonsSoon).observe(chatEl, { childList: true });
    } catch (e) { /* ignore */ }
    bind('nnb_ward_img', 'wardrobeImages', 'checkbox');
    bind('nnb_img_ref', 'imageRef', 'checkbox');
    bind('nnb_accents', 'accents', 'checkbox');
    bind('nnb_action_prompts', 'actionPrompts', 'checkbox');
    $('#nnb_action_prompts').on('change', renderActionPrompts);
    fillImageSources();
    $('.npc-notebook-settings .inline-drawer-toggle').on('click', fillImageSources);
    $('#nnb_img_src').on('change', function () {
        settings().imageSource = String($(this).val() || '');
        saveSettings();
        $('#nnb_img_api').toggle(settings().imageSource === 'openai-images');
    });
    bind('nnb_img_base', 'imgApiBase');
    bind('nnb_img_key', 'imgApiKey');
    bind('nnb_img_model', 'imgApiModel');
    bind('nnb_img_orient', 'imgOrientation');
    $('#nnb_ff_on').on('change', placeFfButton);
    bind('nnb_interval', 'interval', 'number');
    bind('nnb_depth', 'depth', 'number');
    bind('nnb_max', 'maxActive', 'number');
    bind('nnb_max_int', 'maxIntrigues', 'number');
    bind('nnb_events', 'events', 'checkbox');
    bind('nnb_lead', 'leadDays', 'number');
    bind('nnb_min_stim', 'minStimuli', 'number');
    bind('nnb_role', 'role', 'number');
    bind('nnb_think_prompt', 'thinkPrompt');
    bind('nnb_inject_prompt', 'injectPrompt');

    $('#nnb_custom_genre').on('input', function () {
        const st = store();
        if (!st) return;
        st.direction.customGenre = $(this).val();
        saveDirectionSoon();
    });
    $('#nnb_mix').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.mixMode = $(this).val();
        saveDirectionSoon();
    });
    $('#nnb_intrigues_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.intrigues = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_time_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.time = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_arcs_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.arcs = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_npcs_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.npcs = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_lines').on('input', function () {
        const st = store();
        if (!st) return;
        st.direction.lines = $(this).val();
        saveDirectionSoon();
        updateInjection();
    });
    $('#nnb_map_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.map = $(this).prop('checked');
        placeMesButtons();
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_living_world_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.livingWorld = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_gacha_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.gacha = $(this).prop('checked');
        placeMesButtons();
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_wardrobe_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.wardrobe = $(this).prop('checked');
        placeMesButtons();
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });

    $('#nnb_think_now').on('click', () => think(true));
    $('#nnb_world_now, #nnb_create_world_btn, #nnb_open_world').on('click', () => { closeBook(); openWorldCreator(); });
    addMenuItems();
    placeFfButton();
    $('#nnb_add').on('click', async () => {
        const st = store();
        if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
        const t = await askText('Новая запись (можно начать с [тег])');
        if (!t || !t.trim()) return;
        const m = t.trim().match(/^\[([^\]]{1,40})\]\s*(.+)$/s);
        st.notes.push({ id: st.nextId++, tag: m ? m[1] : '', text: m ? m[2] : t.trim(), at: ctx().chat.length });
        await commit();
    });
    $('#nnb_clear').on('click', async () => {
        const st = store();
        if (!st || !confirm('Удалить все записи и архив этого чата?')) return;
        st.notes = [];
        st.archive = [];
        st.lastRaw = '';
        st.rejected = [];
        st.intrigues = [];
        await commit();
    });
    $('#nnb_reset_think').on('click', () => {
        settings().thinkPrompt = DEFAULT_THINK;
        $('#nnb_think_prompt').val(DEFAULT_THINK);
        saveSettings();
    });
    $('#nnb_reset_inject').on('click', () => {
        settings().injectPrompt = DEFAULT_INJECT;
        $('#nnb_inject_prompt').val(DEFAULT_INJECT);
        saveSettings();
        updateInjection();
    });

    const ev = c.event_types;
    c.eventSource.on(ev.MESSAGE_RECEIVED, onMessageReceived);
    for (const e of [ev.MESSAGE_SENT, ev.CHAT_CHANGED, ev.MESSAGE_DELETED]) {
        if (e) c.eventSource.on(e, () => { updateInjection(); renderPanel(); });
    }
    c.eventSource.on(ev.CHAT_CHANGED, renderDirection);
    for (const e of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED']) {
        if (ev[e]) c.eventSource.on(ev[e], placeMesButtonsSoon);
    }
    c.eventSource.on(ev.CHAT_CHANGED, clearFastForward);
    if (ev.MESSAGE_SENT) c.eventSource.on(ev.MESSAGE_SENT, onMessageSentHint);
    if (ev.GENERATION_STOPPED) c.eventSource.on(ev.GENERATION_STOPPED, clearFastForward);
    if (ev.CHAT_COMPLETION_PROMPT_READY) c.eventSource.on(ev.CHAT_COMPLETION_PROMPT_READY, fixOwnPromptRole);

    updateInjection();
    renderPanel();
    renderDirection();
    placeMesButtons();
});