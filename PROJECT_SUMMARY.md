# 📦 Project Summary - Video Processing Pipeline

## 🎯 Цель проекта

Автоматизированный пайплайн для обработки видео для приложения по изучению английского языка. Система анализирует видео с помощью AI и создаёт образовательный контент.

## 🏗 Архитектура

### Структура проекта
```
.
├── video-pipeline/
│   ├── input/              # Входные видео файлы (загружаются вручную)
│   ├── output/             # Результаты в JSON формате
│   ├── temp/               # Временные файлы (аудио)
│   ├── config/
│   │   └── config.js       # Конфигурация (БД, Ollama, темы)
│   └── src/
│       ├── audio/
│       │   └── extractor.js       # FFmpeg - извлечение аудио
│       ├── transcription/
│       │   └── whisper.js         # Whisper - транскрипция с таймкодами
│       ├── analysis/
│       │   └── textAnalyzer.js    # Ollama - анализ уровня и тем
│       ├── exercises/
│       │   └── generator.js       # Ollama - генерация упражнений
│       ├── database/
│       │   ├── db.js              # Работа с MySQL
│       │   └── migrations.sql     # SQL схема
│       ├── index.js               # Главный пайплайн
│       └── check-setup.js         # Проверка настроек
├── package.json
├── .env
├── .gitignore
├── README.md              # Полная документация
├── QUICKSTART.md          # Быстрый старт
├── USAGE.md               # Примеры использования
└── PROJECT_SUMMARY.md     # Этот файл
```

## 🔄 Pipeline Flow

```
┌─────────────┐
│ Input Video │
│   (.mp4)    │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│  1. Extract Audio   │
│     (FFmpeg)        │
│  → WAV 16kHz mono   │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  2. Transcription   │
│     (Whisper)       │
│  → Text + Timestamps│
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  3. Text Analysis   │
│   (Ollama + phi3)   │
│  → CEFR, Topics     │
│  → Complexity       │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 4. Generate Tasks   │
│   (Ollama + phi3)   │
│  → Exercises        │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  5. Save to DB      │
│     (MySQL)         │
│  → JSON Output      │
└─────────────────────┘
```

## 🛠 Технологии

### Backend
- **Node.js** - основной runtime
- **FFmpeg** - обработка видео/аудио
- **@xenova/transformers** - Whisper модель для транскрипции
- **Ollama** - локальный AI (phi3) для анализа и генерации
- **MySQL** - хранение данных
- **mysql2** - драйвер для MySQL

### AI Models
1. **Whisper (small)** - транскрипция речи в текст с таймкодами
   - Работает локально через Transformers.js
   - Размер модели: ~500MB
   - Точность: высокая для английского

2. **Phi3** (через Ollama) - анализ текста и генерация упражнений
   - Работает локально через Ollama
   - Размер модели: ~2.3GB
   - Быстрая и эффективная модель от Microsoft

## 📊 Данные

### База данных

**Таблица: `video_learning_content`**
```sql
- id: INT (PK)
- video_name: VARCHAR(255)
- video_url: VARCHAR(500) NULL
- cefr_level: ENUM(A1, A2, B1, B2, C1, C2)
- speech_speed: ENUM(slow, normal, fast)
- grammar_complexity: ENUM(simple, intermediate, complex)
- vocabulary_complexity: ENUM(basic, intermediate, advanced)
- topics: JSON
- transcript_full: TEXT
- transcript_chunks: JSON
- exercises: JSON
- processed_at: TIMESTAMP
- status: ENUM
```

**Таблица: `video_topics`**
```sql
- id: INT (PK)
- video_id: INT (FK)
- topic: VARCHAR(100)
```

### JSON Output Format
```json
{
  "videoName": "example.mp4",
  "transcription": {
    "fullText": "...",
    "chunks": [
      {"text": "word", "timestamp": [0.0, 0.5]}
    ]
  },
  "analysis": {
    "cefrLevel": "B1",
    "speechSpeed": "normal",
    "grammarComplexity": "intermediate",
    "vocabularyComplexity": "intermediate",
    "topics": ["Technology", "Education"]
  },
  "exercises": [
    {
      "type": "vocabulary|fillInBlank|multipleChoice",
      "question": "...",
      "options": ["...", "..."],
      "correctAnswer": 0
    }
  ]
}
```

## 🎓 Темы видео (40 штук)

Business, Technology, Science, Health, Education, Entertainment, Sports, Travel, Food, Fashion, Art, Music, Movies, Gaming, News, Politics, History, Nature, Animals, Space, Environment, Social Issues, Psychology, Philosophy, Lifestyle, Relationships, Career, Finance, Motivation, Comedy, Drama, Documentary, Tutorial, Review, Interview, Vlog, Challenge, Story, Daily Life

## 📝 Типы упражнений

1. **Vocabulary** - сопоставление слов с определениями
2. **Fill in the blank** - заполнение пропусков в предложениях
3. **Multiple choice** - вопросы о контенте или грамматике
4. **Phrase practice** - запоминание фраз из видео

## 🚀 Команды

```bash
# Установка
npm install

# Проверка готовности системы
npm run check

# Запуск пайплайна
npm start
# или
npm run process
```

## 🔐 Конфигурация

### База данных (.env или config.js)
```javascript
database: {
  host: 'mgodag3j.beget.tech',
  port: 3306,
  user: 'mgodag3j_english',
  password: 'Mais19970619',
  database: 'mgodag3j_english'
}
```

### Ollama (config.js)
```javascript
ollama: {
  host: 'http://localhost:11434',
  model: 'phi3'
}
```

## ⚡️ Performance

### Время обработки (примерно)

Для 1 минуты видео:
- Извлечение аудио: ~10 сек
- Транскрипция (Whisper): ~30-60 сек
- Анализ текста (Ollama): ~5-10 сек
- Генерация упражнений (Ollama): ~10-15 сек
- Сохранение в БД: ~1 сек

**Итого: ~1-2 минуты на 1 минуту видео**

### Требования к системе

**Минимальные:**
- CPU: 4 ядра
- RAM: 8GB
- Disk: 5GB свободного места

**Рекомендуемые:**
- CPU: 8+ ядер
- RAM: 16GB
- Disk: 10GB свободного места
- SSD для быстрой работы

## 🔄 Workflow использования

### 1. Подготовка (один раз)
- Установить Ollama + phi3
- Запустить `npm install`
- Проверить настройки: `npm run check`

### 2. Обработка видео
- Добавить видео в `video-pipeline/input/`
- Запустить `npm start`
- Получить результаты в БД и `video-pipeline/output/`

### 3. Интеграция с приложением
- Получать данные из БД через API
- Использовать transcript_chunks для субтитров
- Показывать exercises после просмотра видео
- Фильтровать видео по CEFR уровню и темам

## 🔮 Будущие улучшения

### Ближайшие
- [ ] Интеграция с S3 для хранения видео
- [ ] Поле video_url в БД для CDN ссылок
- [ ] API для загрузки видео

### Долгосрочные
- [ ] Параллельная обработка нескольких видео
- [ ] Очередь задач (Bull/Redis)
- [ ] Web UI для мониторинга
- [ ] Webhooks для уведомлений
- [ ] Поддержка других языков
- [ ] Улучшенная генерация упражнений
- [ ] A/B тестирование разных промптов

## 📖 Документация

- **README.md** - полная документация проекта
- **QUICKSTART.md** - быстрый старт для новых пользователей
- **USAGE.md** - примеры использования, SQL запросы, интеграция
- **PROJECT_SUMMARY.md** - этот файл (обзор архитектуры)

## 🔗 Связанные файлы

### Конфигурация
- [`video-pipeline/config/config.js`](video-pipeline/config/config.js) - все настройки
- [`.env`](.env) - чувствительные данные (не в git)
- [`.gitignore`](.gitignore) - что не коммитить

### Модули
- [`video-pipeline/src/index.js`](video-pipeline/src/index.js) - главный пайплайн
- [`video-pipeline/src/check-setup.js`](video-pipeline/src/check-setup.js) - проверка системы

### База данных
- [`video-pipeline/src/database/migrations.sql`](video-pipeline/src/database/migrations.sql) - SQL схема
- [`video-pipeline/src/database/db.js`](video-pipeline/src/database/db.js) - работа с БД

## ✅ Статус проекта

**✅ Готово к использованию!**

Все компоненты реализованы и готовы к работе:
- ✅ Извлечение аудио (FFmpeg)
- ✅ Транскрипция (Whisper)
- ✅ Анализ текста (Ollama)
- ✅ Генерация упражнений (Ollama)
- ✅ Сохранение в БД (MySQL)
- ✅ Миграции БД
- ✅ Проверка настроек
- ✅ Документация

## 🎯 Следующий шаг

1. Прочитайте [QUICKSTART.md](QUICKSTART.md)
2. Запустите `npm run check`
3. Добавьте тестовое видео
4. Запустите `npm start`
5. Проверьте результаты!

---

**Автор:** AI Pipeline Generator
**Дата создания:** 2025-10-20
**Версия:** 1.0.0
