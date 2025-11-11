## Data Contracts (Type Reference)

```ts
// Shared enums
type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
type SpeechSpeed = 'slow' | 'normal' | 'fast';
type GrammarComplexity = 'simple' | 'intermediate' | 'complex';
type VocabularyComplexity = 'basic' | 'intermediate' | 'advanced';

type Timestamp = [number, number];

interface TranscriptChunk {
  text: string;            // text fragment (no HTML)
  timestamp: Timestamp;    // [startSeconds, endSeconds]
}

interface TranscriptionResult {
  fullText: string;        // concatenated transcript
  text: string;            // alias for fullText (for compatibility)
  chunks: TranscriptChunk[];
}

interface TranslationResult extends TranscriptionResult {}

interface AnalysisResult {
  cefrLevel: CEFRLevel;
  speechSpeed: SpeechSpeed;
  grammarComplexity: GrammarComplexity;
  vocabularyComplexity: VocabularyComplexity;
  topics: string[];        // up to 3 topics taken from config.videoTopics
}

type ExerciseType = 'vocabulary' | 'topic' | 'statementCheck';

interface BaseExercise {
  type: ExerciseType;
  question: string;        // Russian description for the learner
  options: string[];       // 3–4 options (language depends on type)
  correctAnswer: number;   // index of correct option
}

interface VocabularyExercise extends BaseExercise {
  type: 'vocabulary';
  word: string;            // word/phrase to translate (ru or en)
}

interface TopicExercise extends BaseExercise {
  type: 'topic';
}

interface StatementExercise extends BaseExercise {
  type: 'statementCheck';
}

type Exercise = VocabularyExercise | TopicExercise | StatementExercise;

interface ProcessedVideo {
  videoName: string;
  videoUrl: string;              // CDN URL
  durationSeconds: number | null;
  transcription: TranscriptionResult;
  translation: TranslationResult;
  analysis: AnalysisResult;
  exercises: Exercise[];
}
```

> **Важно:** каждая стадия пайплайна придерживается этих типов.  
> При несоответствии данных (например, если ИИ вернул неправильное значение)
> мы повторяем запрос. Если после нескольких попыток результат всё равно невалиден,
> выполнение останавливается с ошибкой — чтобы в приложение не попали некорректные данные.
