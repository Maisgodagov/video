# Настройка Google Cloud VM для видеопайплайна

## Часть 1: Создание и настройка VM

### Шаг 1: Создание проекта в Google Cloud

1. Перейдите на [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите Compute Engine API:
   ```bash
   gcloud services enable compute.googleapis.com
   ```

### Шаг 2: Создание VM инстанса

#### Через веб-интерфейс:

1. Перейдите в **Compute Engine** → **VM instances**
2. Нажмите **Create Instance**
3. Настройте параметры:
   - **Name**: `video-pipeline-vm`
   - **Region**: выберите ближайший регион (например, `europe-west1`)
   - **Machine type**:
     - Минимум: `e2-standard-2` (2 vCPU, 8 GB RAM)
     - Рекомендуется: `e2-standard-4` (4 vCPU, 16 GB RAM) для Whisper
   - **Boot disk**:
     - Операционная система: **Ubuntu 22.04 LTS**
     - Тип: **Balanced persistent disk**
     - Размер: **50 GB** (минимум для Whisper моделей и временных файлов)
   - **Firewall**:
     - Разрешить HTTP и HTTPS трафик (если планируете API)

#### Через gcloud CLI:

```bash
gcloud compute instances create video-pipeline-vm \
  --zone=europe-west1-b \
  --machine-type=e2-standard-4 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --tags=http-server,https-server
```

### Шаг 3: Подключение к VM

```bash
# Подключение через SSH
gcloud compute ssh video-pipeline-vm --zone=europe-west1-b

# Или через веб-интерфейс: нажмите SSH рядом с вашим инстансом
```

### Шаг 4: Установка необходимого ПО на VM

После подключения к VM выполните:

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Проверка установки
node --version  # должно быть v20.x.x
npm --version

# Установка Git
sudo apt install -y git

# Установка Python 3.11 для Whisper
sudo apt install -y python3.11 python3.11-venv python3-pip

# Установка ffmpeg
sudo apt install -y ffmpeg

# Проверка ffmpeg
ffmpeg -version

# Установка CUDA (если хотите использовать GPU для Whisper)
# Только если выбрали инстанс с GPU!
# sudo apt install -y nvidia-cuda-toolkit
```

### Шаг 5: Настройка Python окружения для Whisper

```bash
# Создание виртуального окружения
python3.11 -m venv ~/whisper-env

# Активация окружения
source ~/whisper-env/bin/activate

# Установка openai-whisper
pip install --upgrade pip
pip install openai-whisper

# Проверка установки
whisper --help
```

### Шаг 6: Клонирование проекта

```bash
# Создание директории для проекта
mkdir -p ~/projects
cd ~/projects

# Клонирование репозитория (замените на ваш репозиторий)
git clone <your-repo-url> video-pipeline
cd video-pipeline

# Или загрузка через scp с локальной машины
# На локальной машине выполните:
# gcloud compute scp --recurse ./video-pipeline video-pipeline-vm:~/projects/ --zone=europe-west1-b
```

### Шаг 7: Установка зависимостей проекта

```bash
cd ~/projects/video-pipeline

# Установка npm пакетов
npm install

# Создание необходимых директорий
mkdir -p video-pipeline/temp
mkdir -p video-pipeline/output
```

### Шаг 8: Настройка переменных окружения

```bash
# Создание .env файла
nano .env
```

Добавьте следующие переменные:

```env
# Google API Keys
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_GEMINI_MODEL=gemini-2.0-flash-001

# Database credentials (используйте существующие из вашего .env)
DB_HOST=abenirsekuth.beget.app
DB_PORT=3306
DB_USER=mgodag3j_english
DB_PASSWORD=Gmr19970619.!
DB_NAME=mgodag3j_english

# S3 Configuration (будет настроено в следующей части)
S3_INPUT_BUCKET=your-input-bucket-name
S3_ENDPOINT=https://storage.googleapis.com
S3_REGION=us-central1
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key

# Python path for Whisper
PYTHON_EXECUTABLE=/home/your-username/whisper-env/bin/python
```

Сохраните файл (Ctrl+O, Enter, Ctrl+X)

### Шаг 9: Настройка автозапуска (опционально)

Создайте systemd сервис для автоматического запуска:

```bash
sudo nano /etc/systemd/system/video-pipeline.service
```

Содержимое:

```ini
[Unit]
Description=Video Processing Pipeline
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/projects/video-pipeline
Environment=PATH=/home/your-username/whisper-env/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /home/your-username/projects/video-pipeline/video-pipeline/src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=append:/home/your-username/projects/video-pipeline/pipeline.log
StandardError=append:/home/your-username/projects/video-pipeline/pipeline-error.log

[Install]
WantedBy=multi-user.target
```

Замените `your-username` на ваше имя пользователя.

Активируйте сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable video-pipeline.service
sudo systemctl start video-pipeline.service

# Проверка статуса
sudo systemctl status video-pipeline.service

# Просмотр логов
sudo journalctl -u video-pipeline.service -f
```

## Часть 2: Настройка доступа к VM

### Создание статического IP (опционально)

```bash
# Создание статического внешнего IP
gcloud compute addresses create video-pipeline-ip --region=europe-west1

# Получение IP адреса
gcloud compute addresses describe video-pipeline-ip --region=europe-west1

# Привязка к VM
gcloud compute instances delete-access-config video-pipeline-vm \
  --zone=europe-west1-b \
  --access-config-name="external-nat"

gcloud compute instances add-access-config video-pipeline-vm \
  --zone=europe-west1-b \
  --access-config-name="external-nat" \
  --address=$(gcloud compute addresses describe video-pipeline-ip --region=europe-west1 --format="get(address)")
```

### Настройка Firewall (если нужен API endpoint)

```bash
# Открытие порта для API (например, 3000)
gcloud compute firewall-rules create allow-video-api \
  --allow=tcp:3000 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server
```

## Часть 3: Мониторинг и обслуживание

### Полезные команды

```bash
# Подключение к VM
gcloud compute ssh video-pipeline-vm --zone=europe-west1-b

# Остановка VM
gcloud compute instances stop video-pipeline-vm --zone=europe-west1-b

# Запуск VM
gcloud compute instances start video-pipeline-vm --zone=europe-west1-b

# Просмотр логов
tail -f ~/projects/video-pipeline/pipeline.log

# Проверка использования диска
df -h

# Проверка использования памяти
free -h

# Мониторинг процессов
htop  # или top
```

### Backup и восстановление

```bash
# Создание snapshot диска
gcloud compute disks snapshot video-pipeline-vm \
  --snapshot-names=video-pipeline-backup-$(date +%Y%m%d) \
  --zone=europe-west1-b

# Восстановление из snapshot
gcloud compute disks create video-pipeline-vm-restored \
  --source-snapshot=video-pipeline-backup-20250114 \
  --zone=europe-west1-b
```

## Оценка стоимости

Примерная стоимость использования Google Cloud:

- **VM e2-standard-4** (4 vCPU, 16GB RAM): ~$120/месяц (при 24/7 работе)
- **Диск 50GB**: ~$8/месяц
- **Трафик исходящий**: ~$0.12/GB (первые 1TB/месяц бесплатно в некоторых регионах)

**Совет**: Используйте [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator) для точного расчета.

## Оптимизация затрат

1. **Используйте Preemptible/Spot VM** - до 80% дешевле, но могут быть остановлены
2. **Автоматическое выключение** - останавливайте VM когда не используется
3. **Меньший инстанс** - если нагрузка позволяет, используйте e2-standard-2
4. **Regional диски** вместо Zonal для лучшей доступности

## Следующие шаги

После настройки VM переходите к [настройке S3 бакета](./S3_SETUP.md)
