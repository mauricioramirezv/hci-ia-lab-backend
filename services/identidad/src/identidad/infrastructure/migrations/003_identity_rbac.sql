-- Migracion aditiva respecto a 002_accounts.sql; conserva identificadores y hashes.
ALTER TABLE identity.accounts
  ADD COLUMN last_name text,
  ADD COLUMN status text;

UPDATE identity.accounts
SET status = CASE
  WHEN disabled_at IS NOT NULL THEN 'inactive'
  WHEN email_verified_at IS NOT NULL THEN 'active'
  ELSE 'pending'
END;

ALTER TABLE identity.accounts
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT accounts_status_ck CHECK (status IN ('pending','active','inactive','locked')),
  ADD CONSTRAINT accounts_active_verified_ck CHECK (status <> 'active' OR email_verified_at IS NOT NULL),
  ADD CONSTRAINT accounts_status_disabled_ck CHECK ((status = 'inactive') = (disabled_at IS NOT NULL));

CREATE INDEX accounts_status_created_idx ON identity.accounts(status,created_at DESC,id);

CREATE TABLE identity.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text
);
CREATE TABLE identity.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL
);
CREATE TABLE identity.account_roles (
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES identity.roles(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES identity.accounts(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,role_id)
);
CREATE INDEX account_roles_role_idx ON identity.account_roles(role_id,account_id);
CREATE TABLE identity.role_permissions (
  role_id uuid NOT NULL REFERENCES identity.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES identity.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id,permission_id)
);

INSERT INTO identity.roles(code,name,description) VALUES
  ('administrator','Administrador','Gestión global de cuentas y permisos de plataforma'),
  ('participant','Participante','Cuenta para guardar trabajo propio'),
  ('teacher','Profesor','Permisos de plataforma sujetos además a membresía de grupo'),
  ('evaluator','Evaluador','Evaluación de trabajo autorizado')
ON CONFLICT(code) DO NOTHING;

INSERT INTO identity.permissions(code,description) VALUES
  ('account:self:read','Consultar el perfil propio'),
  ('account:self:update','Editar el perfil propio'),
  ('account:manage','Administrar cuentas globales'),
  ('role:assign','Asignar roles globales autorizados'),
  ('workspace:own:read','Leer espacios propios o compartidos explícitamente'),
  ('workspace:own:write','Escribir en espacios propios'),
  ('activity:execute','Ejecutar actividades autenticadas'),
  ('delivery:submit:own','Presentar entregas propias'),
  ('group:manage','Gestionar grupos solo con membresía activa de liderazgo'),
  ('assignment:manage','Gestionar asignaciones solo en grupos autorizados'),
  ('delivery:review','Revisar entregas asignadas y visibles'),
  ('report:generate','Generar informes a partir de fuentes autorizadas')
ON CONFLICT(code) DO NOTHING;

INSERT INTO identity.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM identity.roles r CROSS JOIN identity.permissions p
WHERE (r.code='participant' AND p.code IN ('account:self:read','account:self:update','workspace:own:read','workspace:own:write','activity:execute','delivery:submit:own'))
   OR (r.code='teacher' AND p.code IN ('account:self:read','account:self:update','group:manage','assignment:manage','delivery:review','report:generate'))
   OR (r.code='evaluator' AND p.code IN ('account:self:read','delivery:review','report:generate'))
   OR (r.code='administrator' AND p.code IN ('account:self:read','account:self:update','account:manage','role:assign'))
ON CONFLICT DO NOTHING;

INSERT INTO identity.account_roles(account_id,role_id)
SELECT a.id,r.id FROM identity.accounts a JOIN identity.roles r
  ON r.code=CASE WHEN a.platform_role='admin' THEN 'administrator' ELSE 'participant' END
ON CONFLICT DO NOTHING;

CREATE TABLE identity.account_preferences (
  account_id uuid PRIMARY KEY REFERENCES identity.accounts(id) ON DELETE CASCADE,
  locale text NOT NULL DEFAULT 'es-CO' CHECK(locale IN ('es-CO','en-US','pt-BR','fr-FR','it-IT','ca-ES')),
  dark_theme boolean NOT NULL DEFAULT false,
  high_contrast boolean NOT NULL DEFAULT false,
  font_size_percent smallint NOT NULL DEFAULT 100 CHECK(font_size_percent BETWEEN 100 AND 200 AND font_size_percent%25=0),
  increased_spacing boolean NOT NULL DEFAULT false,
  dyslexia_font boolean NOT NULL DEFAULT false,
  reduced_motion boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL CHECK(outcome IN ('success','denied','failure')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid
);
CREATE INDEX audit_events_resource_time_idx ON identity.audit_events(resource_type,resource_id,occurred_at DESC);

GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA identity TO identity_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA identity TO identity_app;
ALTER DEFAULT PRIVILEGES FOR ROLE identity_owner IN SCHEMA identity GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO identity_app;
ALTER DEFAULT PRIVILEGES FOR ROLE identity_owner IN SCHEMA identity GRANT USAGE,SELECT ON SEQUENCES TO identity_app;
