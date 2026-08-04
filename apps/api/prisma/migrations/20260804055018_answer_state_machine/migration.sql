-- M4: DB-enforced Answer state machine. No schema/column changes needed (the
-- Doubt/Answer/ReviewAudit tables and AuthorType/AnswerState enums already
-- exist from the init migration) — this migration ONLY adds two triggers so
-- illegal answer inserts/transitions are rejected by Postgres itself, not
-- merely by application-layer discipline. See src/doubts/state-machine.ts
-- for the pure, unit-tested mirror of these exact rules.

-- BEFORE INSERT: AI answers may only be born DRAFT; only TEACHER-authored may be born APPROVED.
CREATE OR REPLACE FUNCTION answers_insert_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."authorType" = 'AI' AND NEW."state" <> 'DRAFT' THEN
    RAISE EXCEPTION 'illegal answer insert: AI-authored answers must be born DRAFT (got %)', NEW."state"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."state" = 'APPROVED' AND NEW."authorType" <> 'TEACHER' THEN
    RAISE EXCEPTION 'illegal answer insert: only TEACHER-authored answers may be born APPROVED'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER answers_insert_guard_trg BEFORE INSERT ON answers
  FOR EACH ROW EXECUTE FUNCTION answers_insert_guard();

-- BEFORE UPDATE: only these state transitions are legal (same-state = content edit, always allowed).
CREATE OR REPLACE FUNCTION answers_transition_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."state" IS DISTINCT FROM NEW."state" THEN
    IF NOT (
      (OLD."state" = 'DRAFT'          AND NEW."state" = 'PENDING_REVIEW') OR
      (OLD."state" = 'PENDING_REVIEW' AND NEW."state" IN ('APPROVED','REJECTED'))
    ) THEN
      RAISE EXCEPTION 'illegal answer state transition: % -> %', OLD."state", NEW."state"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER answers_transition_guard_trg BEFORE UPDATE ON answers
  FOR EACH ROW EXECUTE FUNCTION answers_transition_guard();
