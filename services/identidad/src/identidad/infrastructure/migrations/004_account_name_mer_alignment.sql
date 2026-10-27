-- Map the legacy display_name column to the MER account.name attribute without dropping the compatibility column.
ALTER TABLE identity.accounts ADD COLUMN name text;
UPDATE identity.accounts SET name=display_name;
ALTER TABLE identity.accounts ALTER COLUMN name SET DEFAULT '';
ALTER TABLE identity.accounts ALTER COLUMN name SET NOT NULL;

CREATE FUNCTION identity.sync_account_name_compatibility() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.name IS NULL OR NEW.name='' THEN
      NEW.name := NEW.display_name;
    ELSE
      NEW.display_name := NEW.name;
    END IF;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    NEW.display_name := NEW.name;
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    NEW.name := NEW.display_name;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_name_compatibility_trg
BEFORE INSERT OR UPDATE OF name,display_name ON identity.accounts
FOR EACH ROW EXECUTE FUNCTION identity.sync_account_name_compatibility();

ALTER TABLE identity.accounts
  ADD CONSTRAINT accounts_name_compatibility_ck CHECK (name=display_name);

COMMENT ON COLUMN identity.accounts.name IS 'MER account visible name; display_name is retained as a compatibility mirror.';