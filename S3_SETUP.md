# Настройка S3 бакета для входных видео

## Выбор S3 провайдера

У вас есть несколько вариантов:

1. **Google Cloud Storage** (рекомендуется для интеграции с GCP VM)
2. **AWS S3** (классический вариант)
3. **Другие S3-совместимые сервисы** (Beget Cloud Storage - у вас уже есть)

Я покажу настройку для всех трех вариантов.

---

## Вариант 1: Google Cloud Storage (рекомендуется)

### Шаг 1: Создание бакета

#### Через веб-интерфейс:

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Откройте **Cloud Storage** → **Buckets**
3. Нажмите **Create Bucket**
4. Настройте:
   - **Name**: `video-pipeline-input` (глобально уникальное имя)
   - **Location type**: `Region`
   - **Location**: выберите тот же регион, где ваша VM (например, `europe-west1`)
   - **Storage class**: `Standard`
   - **Access control**: `Uniform` (рекомендуется)
   - **Protection tools**: отключите versioning для экономии (если не нужно)

#### Через gcloud CLI:

```bash
# Создание бакета
gsutil mb -p your-project-id -c STANDARD -l europe-west1 gs://video-pipeline-input/

# Или через gcloud
gcloud storage buckets create gs://video-pipeline-input \
  --location=europe-west1 \
  --uniform-bucket-level-access
```

### Шаг 2: Настройка прав доступа

#### Вариант A: Service Account (рекомендуется для безопасности)

```bash
# Создание Service Account
gcloud iam service-accounts create video-pipeline-sa \
  --display-name="Video Pipeline Service Account"

# Назначение прав на бакет
gsutil iam ch serviceAccount:video-pipeline-sa@your-project-id.iam.gserviceaccount.com:objectViewer gs://video-pipeline-input

# Создание ключа
gcloud iam service-accounts keys create ~/video-pipeline-key.json \
  --iam-account=video-pipeline-sa@your-project-id.iam.gserviceaccount.com

# Копирование ключа на VM
gcloud compute scp ~/video-pipeline-key.json video-pipeline-vm:~/projects/video-pipeline/ --zone=europe-west1-b
```

На VM настройте переменную окружения:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/home/your-username/projects/video-pipeline/video-pipeline-key.json"

# Добавьте в .bashrc для постоянства
echo 'export GOOGLE_APPLICATION_CREDENTIALS="/home/your-username/projects/video-pipeline/video-pipeline-key.json"' >> ~/.bashrc
```

#### Вариант B: VM Default Service Account (проще, но менее безопасно)

При создании VM добавьте scope:

```bash
gcloud compute instances create video-pipeline-vm \
  --scopes=storage-ro
  # или storage-rw для чтения и записи
```

### Шаг 3: Настройка в коде

Добавьте в `.env`:

```env
# Google Cloud Storage
GCS_INPUT_BUCKET=video-pipeline-input
GCS_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/home/your-username/projects/video-pipeline/video-pipeline-key.json
```

---

## Вариант 2: AWS S3

### Шаг 1: Создание бакета

#### Через AWS Console:

1. Перейдите в [AWS S3 Console](https://s3.console.aws.amazon.com/)
2. Нажмите **Create bucket**
3. Настройте:
   - **Bucket name**: `video-pipeline-input-yourunique`
   - **Region**: ближайший к вашей VM
   - **Block Public Access**: оставьте включенным
   - **Versioning**: отключите

#### Через AWS CLI:

```bash
aws s3 mb s3://video-pipeline-input-yourunique --region us-east-1
```

### Шаг 2: Создание IAM пользователя

```bash
# Создание пользователя
aws iam create-user --user-name video-pipeline-user

# Создание политики для доступа к бакету
cat > s3-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::video-pipeline-input-yourunique",
        "arn:aws:s3:::video-pipeline-input-yourunique/*"
      ]
    }
  ]
}
EOF

# Применение политики
aws iam create-policy --policy-name VideoPipelineS3ReadOnly --policy-document file://s3-policy.json

# Присоединение политики к пользователю
aws iam attach-user-policy \
  --user-name video-pipeline-user \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/VideoPipelineS3ReadOnly

# Создание access keys
aws iam create-access-key --user-name video-pipeline-user
```

Сохраните `AccessKeyId` и `SecretAccessKey`.

### Шаг 3: Настройка в коде

Добавьте в `.env`:

```env
# AWS S3
S3_INPUT_BUCKET=video-pipeline-input-yourunique
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
```

---

## Вариант 3: Beget Cloud Storage (или другой S3-совместимый)

Вы уже используете Beget для хранения обработанных видео. Можно создать отдельный бакет для входных видео.

### Шаг 1: Создание нового бакета

1. Войдите в панель Beget
2. Перейдите в раздел Cloud Storage
3. Создайте новый бакет:
   - **Имя**: `video-pipeline-input`
   - **Тип**: Приватный

### Шаг 2: Настройка в коде

Используйте те же credentials, что и для основного бакета:

```env
# Beget Cloud Storage для входных видео
S3_INPUT_BUCKET=video-pipeline-input
S3_ENDPOINT=https://s3.ru1.storage.beget.cloud
S3_REGION=ru-1
S3_ACCESS_KEY_ID=3GMH0JAWVGIFOYW9ONVA
S3_SECRET_ACCESS_KEY=h5DDOB7oR7TIIRbT9SDyfywEGOIDinAjbzwyaOt7

# Для выходных видео оставляем старый бакет
S3_OUTPUT_BUCKET=2df681f7f03c-mais-eglish
```

---

## Загрузка видео в S3 бакет

### Способ 1: Веб-интерфейс

#### Google Cloud Storage:
```bash
# Через gsutil
gsutil cp your-video.mp4 gs://video-pipeline-input/

# Загрузка папки
gsutil -m cp -r ./videos/* gs://video-pipeline-input/
```

#### AWS S3:
```bash
aws s3 cp your-video.mp4 s3://video-pipeline-input-yourunique/

# Загрузка папки
aws s3 sync ./videos/ s3://video-pipeline-input-yourunique/
```

#### Beget или другой S3:
```bash
# Используя AWS CLI с custom endpoint
aws s3 cp your-video.mp4 s3://video-pipeline-input/ \
  --endpoint-url=https://s3.ru1.storage.beget.cloud

# Или используя s3cmd
s3cmd put your-video.mp4 s3://video-pipeline-input/
```

### Способ 2: Программная загрузка из Node.js

Пример скрипта для загрузки:

```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});

async function uploadVideo(filePath) {
  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const command = new PutObjectCommand({
    Bucket: process.env.S3_INPUT_BUCKET,
    Key: fileName,
    Body: fileContent,
    ContentType: 'video/mp4'
  });

  await s3Client.send(command);
  console.log(`Uploaded ${fileName} to S3`);
}

// Использование
uploadVideo('./my-video.mp4');
```

---

## Структура бакета (рекомендации)

Организуйте файлы в бакете:

```
video-pipeline-input/
├── pending/          # Новые видео для обработки
│   ├── video1.mp4
│   └── video2.mp4
├── processing/       # Видео в процессе обработки
│   └── video1.mp4
├── completed/        # Обработанные видео (можно удалять)
│   └── video1.mp4
└── failed/          # Видео с ошибками обработки
    └── video2.mp4
```

---

## Настройка Lifecycle Rules (экономия средств)

### Google Cloud Storage:

```bash
# Создание lifecycle конфигурации
cat > lifecycle.json << 'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 30,
          "matchesPrefix": ["completed/"]
        }
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://video-pipeline-input/
```

### AWS S3:

```json
{
  "Rules": [
    {
      "Id": "DeleteCompletedVideos",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "completed/"
      },
      "Expiration": {
        "Days": 30
      }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket video-pipeline-input-yourunique \
  --lifecycle-configuration file://lifecycle.json
```

---

## Тестирование доступа

Создайте тестовый скрипт `test-s3.js`:

```javascript
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});

async function testS3Access() {
  try {
    // Список файлов
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.S3_INPUT_BUCKET,
      MaxKeys: 10
    });

    const listResponse = await s3Client.send(listCommand);
    console.log('✅ S3 connection successful!');
    console.log('Files in bucket:');
    listResponse.Contents?.forEach(file => {
      console.log(`  - ${file.Key} (${(file.Size / 1024 / 1024).toFixed(2)} MB)`);
    });
  } catch (error) {
    console.error('❌ S3 connection failed:', error.message);
  }
}

testS3Access();
```

Запустите:

```bash
node test-s3.js
```

---

## Безопасность

### Рекомендации:

1. **Не храните credentials в коде** - используйте `.env` файл
2. **Добавьте .env в .gitignore**
3. **Используйте минимальные права** - только чтение для входного бакета
4. **Ротация ключей** - меняйте access keys раз в 90 дней
5. **Мониторинг доступа** - настройте алерты на необычную активность

### Шифрование (опционально):

#### Google Cloud Storage:
```bash
# Включение шифрования
gcloud storage buckets update gs://video-pipeline-input \
  --default-encryption-key=projects/PROJECT_ID/locations/LOCATION/keyRings/KEYRING/cryptoKeys/KEY
```

#### AWS S3:
```bash
# Включение AES-256 шифрования
aws s3api put-bucket-encryption \
  --bucket video-pipeline-input-yourunique \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'
```

---

## Мониторинг и алерты

### Google Cloud Storage:

```bash
# Включение логирования
gsutil logging set on -b gs://your-logs-bucket gs://video-pipeline-input
```

### AWS S3:

```bash
# Включение S3 access logging
aws s3api put-bucket-logging \
  --bucket video-pipeline-input-yourunique \
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "your-logs-bucket",
      "TargetPrefix": "s3-access-logs/"
    }
  }'
```

---

## Следующие шаги

После настройки S3 бакета переходите к [модификации кода для работы с S3](./CODE_MIGRATION.md)
