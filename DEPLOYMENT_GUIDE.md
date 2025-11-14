# Полная инструкция по деплою видеопайплайна в Google Cloud

## Обзор

Этот гайд проведет вас через все этапы переноса видеопайплайна в Google Cloud с использованием S3 бакета для входных видео.

## Этапы деплоя

### 📋 Этап 1: Подготовка (локально)

#### 1.1 Проверка текущей версии

Убедитесь, что локальная версия работает:

```bash
# Проверка зависимостей
npm install

# Тестовый запуск (если есть видео в input)
npm start
```

#### 1.2 Установка Google Cloud SDK

```bash
# Windows
# Скачайте установщик: https://cloud.google.com/sdk/docs/install

# Linux/Mac
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Авторизация
gcloud init
gcloud auth login
```

---

### 🗄️ Этап 2: Настройка S3 бакета

Следуйте инструкциям в [S3_SETUP.md](./S3_SETUP.md)

**Краткая версия для Beget Cloud Storage:**

1. Создайте новый бакет `video-pipeline-input` в панели Beget
2. Создайте структуру папок в бакете:
   ```
   video-pipeline-input/
   ├── pending/
   ├── processing/
   ├── completed/
   └── failed/
   ```
3. Используйте существующие credentials (они уже есть в config.js)

**Для Google Cloud Storage:**

```bash
# Создание бакета
gsutil mb -p your-project-id -c STANDARD -l europe-west1 gs://video-pipeline-input/

# Создание папок
gsutil -m cp /dev/null gs://video-pipeline-input/pending/.gitkeep
gsutil -m cp /dev/null gs://video-pipeline-input/processing/.gitkeep
gsutil -m cp /dev/null gs://video-pipeline-input/completed/.gitkeep
gsutil -m cp /dev/null gs://video-pipeline-input/failed/.gitkeep
```

---

### 💻 Этап 3: Создание VM

Следуйте инструкциям в [GOOGLE_CLOUD_SETUP.md](./GOOGLE_CLOUD_SETUP.md)

**Быстрый старт:**

```bash
# Создание VM
gcloud compute instances create video-pipeline-vm \
  --zone=europe-west1-b \
  --machine-type=e2-standard-4 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --scopes=storage-rw

# Проверка создания
gcloud compute instances list
```

---

### 🚀 Этап 4: Настройка VM

#### 4.1 Подключение к VM

```bash
gcloud compute ssh video-pipeline-vm --zone=europe-west1-b
```

#### 4.2 Установка необходимого ПО

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Git
sudo apt install -y git

# Python для Whisper
sudo apt install -y python3.11 python3.11-venv python3-pip

# FFmpeg
sudo apt install -y ffmpeg

# Проверка установки
node --version
python3.11 --version
ffmpeg -version
```

#### 4.3 Настройка Whisper

```bash
# Создание виртуального окружения
python3.11 -m venv ~/whisper-env

# Активация
source ~/whisper-env/bin/activate

# Установка Whisper
pip install --upgrade pip
pip install openai-whisper

# Проверка
whisper --help

# Добавление в автозагрузку
echo 'source ~/whisper-env/bin/activate' >> ~/.bashrc
```

---

### 📦 Этап 5: Деплой кода на VM

#### 5.1 Локально: Подготовка к деплою

```bash
# Убедитесь что .env не будет загружен (он в .gitignore)
# Проверьте .gitignore
cat .gitignore
```

#### 5.2 Вариант A: Использование скрипта деплоя

```bash
# Отредактируйте deploy-to-vm.sh, укажите ваши параметры
nano deploy-to-vm.sh

# Сделайте скрипт исполняемым (Linux/Mac)
chmod +x deploy-to-vm.sh

# Запустите деплой
./deploy-to-vm.sh
```

#### 5.3 Вариант B: Ручная загрузка

```bash
# Создание архива (исключая ненужные файлы)
tar -czf video-pipeline.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='video-pipeline/input/*' \
  --exclude='video-pipeline/output/*' \
  --exclude='video-pipeline/temp/*' \
  --exclude='*.log' \
  --exclude='.env' \
  .

# Загрузка на VM
gcloud compute scp video-pipeline.tar.gz video-pipeline-vm:~/ --zone=europe-west1-b

# Подключение к VM
gcloud compute ssh video-pipeline-vm --zone=europe-west1-b

# На VM: извлечение и настройка
mkdir -p ~/projects
cd ~/projects
tar -xzf ~/video-pipeline.tar.gz
mv video-pipeline-* video-pipeline  # если нужно
cd video-pipeline

# Установка зависимостей
npm install --production

# Создание директорий
mkdir -p video-pipeline/temp
mkdir -p video-pipeline/output
```

---

### 🔧 Этап 6: Настройка переменных окружения

#### 6.1 Создание .env файла на VM

```bash
# На VM
cd ~/projects/video-pipeline
nano .env
```

#### 6.2 Заполнение .env

Скопируйте из `.env.example` и заполните реальными значениями:

```env
# Включение S3 input
USE_S3_INPUT=true

# S3 Configuration (для Beget)
S3_INPUT_BUCKET=video-pipeline-input
S3_INPUT_ENDPOINT=https://s3.ru1.storage.beget.cloud
S3_INPUT_REGION=ru-1
S3_INPUT_ACCESS_KEY_ID=3GMH0JAWVGIFOYW9ONVA
S3_INPUT_SECRET_ACCESS_KEY=h5DDOB7oR7TIIRbT9SDyfywEGOIDinAjbzwyaOt7

# Google Gemini API
GOOGLE_API_KEY=ваш_реальный_ключ
GOOGLE_GEMINI_API_KEY=ваш_реальный_ключ

# Python path на VM
PYTHON_EXECUTABLE=/home/YOUR_USERNAME/whisper-env/bin/python

# Остальные настройки...
```

Замените `YOUR_USERNAME` на ваше реальное имя пользователя на VM (команда `whoami`).

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

---

### ✅ Этап 7: Тестирование

#### 7.1 Тест подключения к S3

```bash
cd ~/projects/video-pipeline

# Создайте тестовый скрипт
cat > test-s3.js << 'EOF'
const { S3InputManager } = require('./video-pipeline/src/storage/s3Input');
require('dotenv').config();

async function test() {
  try {
    const s3 = new S3InputManager();
    const videos = await s3.listPendingVideos();
    console.log('✅ S3 connection successful!');
    console.log('Videos found:', videos.length);
    videos.forEach(v => console.log(`  - ${v.name}`));
  } catch (error) {
    console.error('❌ S3 connection failed:', error.message);
  }
}

test();
EOF

# Запустите тест
node test-s3.js
```

#### 7.2 Загрузка тестового видео в S3

**Локально:**

```bash
# Используя AWS CLI
aws s3 cp test-video.mp4 s3://video-pipeline-input/pending/ \
  --endpoint-url=https://s3.ru1.storage.beget.cloud

# Или через веб-интерфейс Beget
```

**Для Google Cloud Storage:**

```bash
gsutil cp test-video.mp4 gs://video-pipeline-input/pending/
```

#### 7.3 Первый запуск пайплайна

```bash
cd ~/projects/video-pipeline

# Активация Whisper окружения
source ~/whisper-env/bin/activate

# Запуск пайплайна
node video-pipeline/src/index-s3.js
```

Если все настроено правильно, вы должны увидеть:

```
============================================================
VIDEO PROCESSING PIPELINE (S3 INPUT)
============================================================

Running database migrations...
Fetching videos from S3 bucket...
  Bucket: video-pipeline-input
  Prefix: pending/

Found 1 video(s) in S3:
  1. test-video.mp4 (15.30 MB)

============================================================
Processing 1/1: test-video.mp4
============================================================
  -> Moved test-video.mp4 to processing folder
  -> Downloading test-video.mp4 from S3...
  -> Downloaded 15.30 MB

[Step 1/8] Extracting audio and metadata...
...
```

---

### 🔄 Этап 8: Режимы работы

#### 8.1 Однократная обработка (по требованию)

```bash
# Обрабатывает все видео из pending/ папки и останавливается
node video-pipeline/src/index-s3.js
```

#### 8.2 Режим непрерывного мониторинга (polling)

```bash
# Активируйте polling в .env
echo 'S3_INPUT_ENABLE_POLLING=true' >> .env
echo 'S3_INPUT_POLLING_INTERVAL=60' >> .env  # проверка каждые 60 секунд

# Запустите в режиме watch
node video-pipeline/src/index-s3.js --watch
```

Пайплайн будет каждые 60 секунд проверять папку `pending/` и автоматически обрабатывать новые видео.

#### 8.3 Локальный режим (без S3)

```bash
# Отключите S3 в .env
USE_S3_INPUT=false

# Запустите обычный пайплайн
node video-pipeline/src/index.js
```

---

### 🤖 Этап 9: Автоматизация (systemd service)

#### 9.1 Создание сервиса

```bash
sudo nano /etc/systemd/system/video-pipeline.service
```

Содержимое:

```ini
[Unit]
Description=Video Processing Pipeline (S3 Input)
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/projects/video-pipeline
Environment=PATH=/home/YOUR_USERNAME/whisper-env/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /home/YOUR_USERNAME/projects/video-pipeline/video-pipeline/src/index-s3.js --watch
Restart=on-failure
RestartSec=30
StandardOutput=append:/home/YOUR_USERNAME/projects/video-pipeline/pipeline.log
StandardError=append:/home/YOUR_USERNAME/projects/video-pipeline/pipeline-error.log

[Install]
WantedBy=multi-user.target
```

Замените `YOUR_USERNAME` на ваше имя пользователя.

#### 9.2 Активация сервиса

```bash
# Перезагрузка конфигурации
sudo systemctl daemon-reload

# Включение автозапуска
sudo systemctl enable video-pipeline.service

# Запуск сервиса
sudo systemctl start video-pipeline.service

# Проверка статуса
sudo systemctl status video-pipeline.service

# Просмотр логов
tail -f ~/projects/video-pipeline/pipeline.log
```

#### 9.3 Управление сервисом

```bash
# Остановка
sudo systemctl stop video-pipeline.service

# Перезапуск
sudo systemctl restart video-pipeline.service

# Просмотр логов через journalctl
sudo journalctl -u video-pipeline.service -f
```

---

### 📊 Этап 10: Мониторинг

#### 10.1 Проверка статуса VM

```bash
# Использование ресурсов
htop  # или top

# Использование диска
df -h

# Использование памяти
free -h

# Проверка сетевой активности
nethogs  # sudo apt install nethogs
```

#### 10.2 Проверка S3 бакета

```bash
# Список файлов в каждой папке
aws s3 ls s3://video-pipeline-input/pending/ --endpoint-url=https://s3.ru1.storage.beget.cloud
aws s3 ls s3://video-pipeline-input/processing/ --endpoint-url=https://s3.ru1.storage.beget.cloud
aws s3 ls s3://video-pipeline-input/completed/ --endpoint-url=https://s3.ru1.storage.beget.cloud
aws s3 ls s3://video-pipeline-input/failed/ --endpoint-url=https://s3.ru1.storage.beget.cloud
```

#### 10.3 Мониторинг логов

```bash
# Просмотр логов в реальном времени
tail -f ~/projects/video-pipeline/pipeline.log

# Поиск ошибок
grep -i error ~/projects/video-pipeline/pipeline.log

# Последние 100 строк
tail -n 100 ~/projects/video-pipeline/pipeline.log
```

---

### 🔧 Устранение неполадок

#### Проблема: S3 connection failed

**Решение:**
1. Проверьте credentials в `.env`
2. Убедитесь что бакет существует
3. Проверьте endpoint URL

```bash
# Тест подключения
node test-s3.js
```

#### Проблема: Whisper not found

**Решение:**
1. Проверьте путь к Python в `.env`
2. Убедитесь что Whisper установлен

```bash
source ~/whisper-env/bin/activate
whisper --help
which python
```

#### Проблема: Out of memory

**Решение:**
1. Увеличьте размер VM (machine-type)
2. Используйте меньшую модель Whisper (tiny, base вместо small)

#### Проблема: Видео не обрабатываются

**Решение:**
1. Проверьте формат видео (mp4, mov, avi, mkv, webm)
2. Проверьте права доступа к S3
3. Проверьте логи: `tail -f pipeline.log`

---

### 🎯 Workflow использования

1. **Загрузка видео:**
   ```bash
   aws s3 cp video.mp4 s3://video-pipeline-input/pending/ --endpoint-url=...
   ```

2. **Автоматическая обработка:**
   - Пайплайн обнаруживает видео
   - Перемещает в `processing/`
   - Обрабатывает видео
   - При успехе → `completed/`
   - При ошибке → `failed/`

3. **Получение результатов:**
   - JSON в папке `output/`
   - Данные в базе данных
   - Обработанное видео в основном S3 бакете (Beget CDN)

---

### 💰 Оптимизация затрат

1. **Останавливайте VM когда не используется:**
   ```bash
   gcloud compute instances stop video-pipeline-vm --zone=europe-west1-b
   ```

2. **Используйте Spot/Preemptible VM** (до 80% дешевле)

3. **Настройте lifecycle rules для S3** - автоматическое удаление старых файлов

4. **Мониторьте использование:** Google Cloud Console → Billing

---

### 📝 Обновление кода

```bash
# Локально: сделайте изменения
git add .
git commit -m "Update pipeline"

# Создайте новый архив
tar -czf video-pipeline.tar.gz --exclude='node_modules' --exclude='.git' .

# Загрузите на VM
gcloud compute scp video-pipeline.tar.gz video-pipeline-vm:~/ --zone=europe-west1-b

# На VM
gcloud compute ssh video-pipeline-vm --zone=europe-west1-b

cd ~/projects
tar -xzf ~/video-pipeline.tar.gz
cd video-pipeline
npm install

# Перезапустите сервис
sudo systemctl restart video-pipeline.service
```

---

## ✅ Чек-лист готовности к продакшену

- [ ] VM создана и настроена
- [ ] S3 бакет создан со структурой папок
- [ ] Все зависимости установлены (Node.js, Python, ffmpeg)
- [ ] Whisper настроен и работает
- [ ] `.env` файл создан с реальными credentials
- [ ] Тестовое видео успешно обработано
- [ ] systemd service настроен и работает
- [ ] Логирование настроено
- [ ] Мониторинг работает
- [ ] Backup strategy определена

---

## 🆘 Поддержка

При возникновении проблем:

1. Проверьте логи: `tail -f pipeline.log`
2. Проверьте systemd: `sudo journalctl -u video-pipeline.service -f`
3. Проверьте S3 подключение: `node test-s3.js`
4. Проверьте resources: `htop`, `df -h`, `free -h`

---

**Готово! Ваш видеопайплайн теперь работает в облаке! 🚀**
