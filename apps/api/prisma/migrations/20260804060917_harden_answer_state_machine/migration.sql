-- Harden the answer transition guard (defense-in-depth for the state machine).
-- The original guard only validated when the state CHANGED, so a same-state
-- UPDATE could (a) mutate the content/editedContent of an already-decided
-- (APPROVED/REJECTED) answer that students already see, or (b) flip authorType.
-- No HTTP path reaches those writes today (review CAS always requires
-- state=PENDING_REVIEW and never touches authorType), but the DB is billed as
-- the ultimate backstop, so it must enforce these too. CREATE OR REPLACE keeps
-- the existing trigger binding; only the function body changes.
CREATE OR REPLACE FUNCTION answers_transition_guard() RETURNS trigger AS $$
BEGIN
  -- authorType is immutable after insert (AI can never become TEACHER, or vice versa).
  IF NEW."authorType" IS DISTINCT FROM OLD."authorType" THEN
    RAISE EXCEPTION 'illegal answer update: authorType is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."state" IS DISTINCT FROM NEW."state" THEN
    -- State change: only these transitions are legal.
    IF NOT (
      (OLD."state" = 'DRAFT'          AND NEW."state" = 'PENDING_REVIEW') OR
      (OLD."state" = 'PENDING_REVIEW' AND NEW."state" IN ('APPROVED','REJECTED'))
    ) THEN
      RAISE EXCEPTION 'illegal answer state transition: % -> %', OLD."state", NEW."state"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- Same-state UPDATE: terminal answers are immutable — a decided answer's
    -- text can never change out from under the students who already see it.
    IF OLD."state" IN ('APPROVED','REJECTED')
       AND (NEW."content" IS DISTINCT FROM OLD."content"
            OR NEW."editedContent" IS DISTINCT FROM OLD."editedContent") THEN
      RAISE EXCEPTION 'illegal answer update: % answers are immutable', OLD."state"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
