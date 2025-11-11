# Примеры использования

## Быстрый старт

### 1. Проверка настроек

Перед запуском проверьте что всё настроено правильно:

```bash
npm run check
```

Эта команда проверит:
- ✅ Ollama запущен и phi3 установлен
- ✅ Подключение к базе данных работает
- ✅ FFmpeg доступен

### 2. Запуск пайплайна

```bash
# Добавьте видео в папку input
cp your-video.mp4 video-pipeline/input/

# Запустите обработку
npm start

# transcription-only pipeline
node video-pipeline/src/index.js --mode=transcription-only

# no-exercises pipeline (transcription + translation + analysis)
npm run core
# or:
# node video-pipeline/src/index.js --mode=no-exercises
```

## Environment
- �������� GOOGLE_TRANSLATE_API_KEY � GOOGLE_GEMINI_API_KEY � ���� .env (����� ������������ ���� � ��� �� ����).
- Google Translate ��������� ����� ��������� �� 4�6 ���� � ����������� ���������.
- Gemini (gemini-1.5-flash) ������ �������� �� ����������� CEFR, ����� ��� � ��������� ����������.


## Структура данных

### Входные данные
Поддерживаемые форматы видео:
- `.mp4` (рекомендуется)
- `.mov`
- `.avi`
- `.mkv`
- `.webm`

### Выходные данные

#### 1. База данных
Таблица `video_learning_content`:

| Поле | Тип | Описание |
|------|-----|----------|
| id | INT | Уникальный ID |
| video_name | VARCHAR(255) | Название файла |
| video_url | VARCHAR(500) | URL на S3/CDN (null пока) |
| cefr_level | ENUM | A1, A2, B1, B2, C1, C2 |
| speech_speed | ENUM | slow, normal, fast |
| grammar_complexity | ENUM | simple, intermediate, complex |
| vocabulary_complexity | ENUM | basic, intermediate, advanced |
| topics | JSON | Массив тем |
| transcript_full | TEXT | Полный текст |
| transcript_chunks | JSON | Слова с таймкодами |
| exercises | JSON | Массив упражнений |
| processed_at | TIMESTAMP | Время обработки |

Таблица `video_topics` (для оптимизации запросов):

| Поле | Тип | Описание |
|------|-----|----------|
| id | INT | Уникальный ID |
| video_id | INT | ID видео |
| topic | VARCHAR(100) | Тема |

#### 2. JSON файлы
В папке `video-pipeline/output/` создается JSON файл для каждого видео:

```json
{
  "videoName": "example.mp4",
  "transcription": {
    "fullText": "Hello everyone, today we're going to talk about...",
    "chunks": [
      {
        "text": "Hello",
        "timestamp": [0.0, 0.5]
      },
      {
        "text": "everyone",
        "timestamp": [0.5, 1.0]
      }
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
      "type": "vocabulary",
      "question": "Match the word with its meaning",
      "word": "technology",
      "options": [
        "the use of science for practical purposes",
        "a book",
        "a place",
        "a person"
      ],
      "correctAnswer": 0
    },
    {
      "type": "fillInBlank",
      "sentence": "Today we're going to ___ about technology",
      "options": ["talk", "walk", "think", "write"],
      "correctAnswer": 0
    },
    {
      "type": "multipleChoice",
      "question": "What is the main topic of this video?",
      "options": [
        "Technology",
        "Sports",
        "Cooking",
        "Travel"
      ],
      "correctAnswer": 0
    }
  ]
}
```

## Запросы к базе данных

### Примеры SQL запросов

#### Получить все видео определенного уровня
```sql
SELECT * FROM video_learning_content
WHERE cefr_level = 'B1';
```

#### Получить видео по теме
```sql
SELECT vlc.*
FROM video_learning_content vlc
JOIN video_topics vt ON vlc.id = vt.video_id
WHERE vt.topic = 'Technology';
```

#### Получить видео с упражнениями и транскриптом
```sql
SELECT
  id,
  video_name,
  cefr_level,
  topics,
  transcript_full,
  exercises,
  processed_at
FROM video_learning_content
WHERE id = 1;
```

#### Статистика по уровням
```sql
SELECT
  cefr_level,
  COUNT(*) as count
FROM video_learning_content
GROUP BY cefr_level
ORDER BY cefr_level;
```

#### Топ тем
```sql
SELECT
  topic,
  COUNT(*) as video_count
FROM video_topics
GROUP BY topic
ORDER BY video_count DESC
LIMIT 10;
```

## Интеграция с бэкендом

### Node.js пример

```javascript
const mysql = require('mysql2/promise');

// Подключение к БД
const connection = await mysql.createConnection({
  host: 'mgodag3j.beget.tech',
  port: 3306,
  user: 'mgodag3j_english',
  password: 'Mais19970619',
  database: 'mgodag3j_english'
});

// Получить видео по уровню
async function getVideosByLevel(cefrLevel) {
  const [rows] = await connection.query(
    'SELECT * FROM video_learning_content WHERE cefr_level = ?',
    [cefrLevel]
  );
  return rows;
}

// Получить случайное видео с упражнениями
async function getRandomVideoWithExercises() {
  const [rows] = await connection.query(`
    SELECT
      id,
      video_name,
      video_url,
      cefr_level,
      topics,
      transcript_chunks,
      exercises
    FROM video_learning_content
    WHERE status = 'completed'
    ORDER BY RAND()
    LIMIT 1
  `);

  if (rows.length > 0) {
    const video = rows[0];
    // Парсим JSON поля
    video.topics = JSON.parse(video.topics);
    video.transcript_chunks = JSON.parse(video.transcript_chunks);
    video.exercises = JSON.parse(video.exercises);
    return video;
  }
  return null;
}

// Получить упражнение для видео
async function getExercisesForVideo(videoId) {
  const [rows] = await connection.query(
    'SELECT exercises FROM video_learning_content WHERE id = ?',
    [videoId]
  );

  if (rows.length > 0) {
    return JSON.parse(rows[0].exercises);
  }
  return [];
}
```

## Настройка модели Ollama

### Использование другой модели

По умолчанию используется `phi3`, но вы можете использовать другие модели:

1. Установите модель:
```bash
ollama pull llama3.2  # или другую модель
```

2. Измените в [`video-pipeline/config/config.js`](video-pipeline/config/config.js):
```javascript
ollama: {
  host: 'http://localhost:11434',
  model: 'llama3.2'  // или другая модель
}
```

### Рекомендуемые модели
- `phi3` - быстрая, хорошо работает (рекомендуется)
- `llama3.2` - более мощная
- `mistral` - хороший баланс
- `gemma2` - от Google

## Оптимизация и настройка

### Ускорение обработки

1. **Используйте меньшую модель Whisper**
   В [`video-pipeline/src/transcription/whisper.js`](video-pipeline/src/transcription/whisper.js):
   ```javascript
   // Вместо 'Xenova/whisper-small'
   transcriber = await pipeline(
     'automatic-speech-recognition',
     'Xenova/whisper-tiny',  // Быстрее, но менее точно
     { quantized: true }
   );
   ```

2. **Batch обработка**
   Скрипт автоматически обрабатывает все видео из папки input последовательно.

### Настройка температуры AI

Для более креативных/консервативных результатов от Ollama, измените `temperature`:

```javascript
// В textAnalyzer.js и generator.js
options: {
  temperature: 0.1,  // 0.0-1.0 (выше = более креативно)
  top_p: 0.9
}
```

## Мониторинг

### Логи
Все логи выводятся в консоль. Для сохранения в файл:

```bash
npm start > logs/process.log 2>&1
```

### Прогресс обработки
Скрипт показывает прогресс:
- Шаги обработки (1/5, 2/5 и т.д.)
- Прогресс FFmpeg
- Результаты каждого этапа

## Troubleshooting

### Whisper загружает модель каждый раз
Модель кэшируется после первой загрузки в `.cache/`. Убедитесь что папка не удаляется.

### Ollama возвращает странные результаты
- Попробуйте другую модель
- Уменьшите `temperature` до 0.1
- Увеличьте контекст в промпте

### Обработка зависает
- Проверьте что достаточно RAM (минимум 8GB)
- Убедитесь что Ollama не упал (`ollama serve`)
- Проверьте логи

### База данных не подключается
- Проверьте что сервер доступен
- Проверьте креды в config.js
- Проверьте фаервол

## Дальнейшее развитие

### TODO
- [ ] Интеграция с S3 для хранения видео
- [ ] API endpoint для загрузки видео
- [ ] Улучшение генерации упражнений
- [ ] Поддержка других языков
- [ ] Web UI для просмотра результатов
- [ ] Очередь задач для параллельной обработки
- [ ] Webhooks для уведомлений о завершении
