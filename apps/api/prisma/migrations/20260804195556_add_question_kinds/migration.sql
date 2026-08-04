-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('CODE', 'MCQ', 'INTEGER');

-- AlterTable
ALTER TABLE "problems" ADD COLUMN     "answerKey" TEXT,
ADD COLUMN     "kind" "QuestionKind" NOT NULL DEFAULT 'CODE',
ADD COLUMN     "options" JSONB;
