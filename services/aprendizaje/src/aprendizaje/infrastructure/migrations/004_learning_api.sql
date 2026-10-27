-- Iteración 5: recibos operativos de idempotencia y catálogo inicial alineado con frontend 2.5.0.
CREATE TABLE learning.write_idempotency (
  account_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,operation,idempotency_key)
);
CREATE INDEX write_idempotency_created_idx ON learning.write_idempotency(created_at);
GRANT SELECT,INSERT,UPDATE ON learning.write_idempotency TO learning_app;

INSERT INTO learning.modulo(codigo,nombre,descripcion,ruta) VALUES
 ('concepts','Conceptos','Prácticas de conceptos de interacción','/concepts'),
 ('patterns','Patrones','Observación de patrones de interacción','/evaluation'),
 ('experiments','Experimentos','Experimentos didácticos Fitts y Hick','/experiments')
ON CONFLICT(codigo) DO NOTHING;

INSERT INTO learning.actividad(modulo_id,codigo,nombre,tipo,activa)
SELECT m.modulo_id,v.codigo,v.nombre,v.tipo,true FROM (VALUES
 ('concepts','concept-practice','Práctica de conceptos','concept'),
 ('patterns','pattern-observation','Observación de patrones','pattern'),
 ('experiments','fitts','Experimento Fitts','experiment'),
 ('experiments','hick','Experimento Hick','experiment')
) AS v(module_code,codigo,nombre,tipo) JOIN learning.modulo m ON m.codigo=v.module_code
ON CONFLICT(modulo_id,codigo) DO NOTHING;

WITH versions(module_code,activity_code,locale,title,description,rules) AS (VALUES
 ('concepts','concept-practice','es-CO','Práctica de conceptos','Registra una reflexión y métricas tipadas de la práctica.','{"conceptCodes":["ux","usability","accessibility","awareness","engagement","emotions","ergonomics","cognition","information","universal","responsibleAI"]}'::jsonb),
 ('concepts','concept-practice','en-US','Concept practice','Record a reflection and typed practice metrics.','{"conceptCodes":["ux","usability","accessibility","awareness","engagement","emotions","ergonomics","cognition","information","universal","responsibleAI"]}'::jsonb),
 ('concepts','concept-practice','pt-BR','Prática de conceitos','Registre uma reflexão e métricas tipadas da prática.','{"conceptCodes":["ux","usability","accessibility","awareness","engagement","emotions","ergonomics","cognition","information","universal","responsibleAI"]}'::jsonb),
 ('concepts','concept-practice','fr-FR','Pratique des concepts','Consignez une réflexion et des mesures typées.','{"conceptCodes":["ux","usability","accessibility","awareness","engagement","emotions","ergonomics","cognition","information","universal","responsibleAI"]}'::jsonb),
 ('concepts','concept-practice','it-IT','Pratica dei concetti','Registra una riflessione e metriche tipizzate.','{"conceptCodes":["ux","usability","accessibility","awareness","engagement","emotions","ergonomics","cognition","information","universal","responsibleAI"]}'::jsonb),
 ('concepts','concept-practice','ca-ES','Pràctica de conceptes','Registreu una reflexió i mètriques tipades.','{"conceptCodes":["ux","usability","accessibility","awareness","engagement","emotions","ergonomics","cognition","information","universal","responsibleAI"]}'::jsonb),
 ('patterns','pattern-observation','es-CO','Observación de patrones','Registra problema, principio y corrección propuestos.','{"patternCodes":["form","navigation","feedback","choice","content","privacy"]}'::jsonb),
 ('patterns','pattern-observation','en-US','Pattern observation','Record the problem, principle and proposed correction.','{"patternCodes":["form","navigation","feedback","choice","content","privacy"]}'::jsonb),
 ('patterns','pattern-observation','pt-BR','Observação de padrões','Registre o problema, o princípio e a correção proposta.','{"patternCodes":["form","navigation","feedback","choice","content","privacy"]}'::jsonb),
 ('patterns','pattern-observation','fr-FR','Observation des modèles','Consignez le problème, le principe et la correction proposée.','{"patternCodes":["form","navigation","feedback","choice","content","privacy"]}'::jsonb),
 ('patterns','pattern-observation','it-IT','Osservazione dei modelli','Registra il problema, il principio e la correzione proposta.','{"patternCodes":["form","navigation","feedback","choice","content","privacy"]}'::jsonb),
 ('patterns','pattern-observation','ca-ES','Observació de patrons','Registreu el problema, el principi i la correcció proposada.','{"patternCodes":["form","navigation","feedback","choice","content","privacy"]}'::jsonb),
 ('experiments','fitts','es-CO','Experimento de Fitts','Dos intentos de práctica y ocho mediciones; no estima parámetros poblacionales.','{"practiceCount":2,"measuredTrials":8,"formula":"log2(D/W+1)","formulaVersion":"HCI-LAB-IA-2.5.0"}'::jsonb),
 ('experiments','fitts','en-US','Fitts experiment','Two practice trials and eight measurements; no population parameters are estimated.','{"practiceCount":2,"measuredTrials":8,"formula":"log2(D/W+1)","formulaVersion":"HCI-LAB-IA-2.5.0"}'::jsonb),
 ('experiments','fitts','pt-BR','Experimento de Fitts','Duas tentativas de prática e oito medições; não estima parâmetros populacionais.','{"practiceCount":2,"measuredTrials":8,"formula":"log2(D/W+1)","formulaVersion":"HCI-LAB-IA-2.5.0"}'::jsonb),
 ('experiments','fitts','fr-FR','Expérience de Fitts','Deux essais pratiques et huit mesures; aucun paramètre de population n’est estimé.','{"practiceCount":2,"measuredTrials":8,"formula":"log2(D/W+1)","formulaVersion":"HCI-LAB-IA-2.5.0"}'::jsonb),
 ('experiments','fitts','it-IT','Esperimento di Fitts','Due prove pratiche e otto misure; non stima parametri di popolazione.','{"practiceCount":2,"measuredTrials":8,"formula":"log2(D/W+1)","formulaVersion":"HCI-LAB-IA-2.5.0"}'::jsonb),
 ('experiments','fitts','ca-ES','Experiment de Fitts','Dos intents de pràctica i vuit mesures; no estima paràmetres poblacionals.','{"practiceCount":2,"measuredTrials":8,"formula":"log2(D/W+1)","formulaVersion":"HCI-LAB-IA-2.5.0"}'::jsonb),
 ('experiments','hick','es-CO','Experimento de Hick','Dos intentos de práctica y ocho mediciones; no estima a ni b.','{"practiceCount":2,"measuredTrials":8,"reference":"T=a+b*log2(n+1)","estimatesParameters":false}'::jsonb),
 ('experiments','hick','en-US','Hick experiment','Two practice trials and eight measurements; a and b are not estimated.','{"practiceCount":2,"measuredTrials":8,"reference":"T=a+b*log2(n+1)","estimatesParameters":false}'::jsonb),
 ('experiments','hick','pt-BR','Experimento de Hick','Duas tentativas de prática e oito medições; a e b não são estimados.','{"practiceCount":2,"measuredTrials":8,"reference":"T=a+b*log2(n+1)","estimatesParameters":false}'::jsonb),
 ('experiments','hick','fr-FR','Expérience de Hick','Deux essais pratiques et huit mesures; a et b ne sont pas estimés.','{"practiceCount":2,"measuredTrials":8,"reference":"T=a+b*log2(n+1)","estimatesParameters":false}'::jsonb),
 ('experiments','hick','it-IT','Esperimento di Hick','Due prove pratiche e otto misure; a e b non vengono stimati.','{"practiceCount":2,"measuredTrials":8,"reference":"T=a+b*log2(n+1)","estimatesParameters":false}'::jsonb),
 ('experiments','hick','ca-ES','Experiment de Hick','Dos intents de pràctica i vuit mesures; no s’estimen a ni b.','{"practiceCount":2,"measuredTrials":8,"reference":"T=a+b*log2(n+1)","estimatesParameters":false}'::jsonb)
)
INSERT INTO learning.actividad_version(actividad_id,numero_version,locale,titulo,descripcion,reglas,publicada_en)
SELECT a.actividad_id,1,v.locale,v.title,v.description,v.rules,now()
FROM versions v JOIN learning.modulo m ON m.codigo=v.module_code JOIN learning.actividad a ON a.modulo_id=m.modulo_id AND a.codigo=v.activity_code
ON CONFLICT(actividad_id,numero_version,locale) DO NOTHING;

WITH metric_seed(module_code,activity_code,codigo,nombre,tipo_valor,unidad,minimo,formula,version_formula,derivada) AS (VALUES
 ('concepts','concept-practice','duration_seconds','duration seconds','numeric','s',0::numeric,NULL::text,NULL::text,false),
 ('concepts','concept-practice','errors','errors','numeric','count',0::numeric,NULL::text,NULL::text,false),
 ('experiments','fitts','trial_seconds','trial seconds','numeric','s',0::numeric,NULL::text,NULL::text,false),
 ('experiments','fitts','trial_errors','trial errors','numeric','count',0::numeric,NULL::text,NULL::text,false),
 ('experiments','fitts','input_mode','input mode','text',NULL,NULL::numeric,NULL::text,NULL::text,false),
 ('experiments','fitts','distance_px','distance','numeric','px',0::numeric,NULL::text,NULL::text,false),
 ('experiments','fitts','index_difficulty','index of difficulty','numeric','bits',0::numeric,'log2(D/W + 1)','HCI-LAB-IA-2.5.0',true),
 ('experiments','hick','trial_seconds','trial seconds','numeric','s',0::numeric,NULL::text,NULL::text,false),
 ('experiments','hick','trial_errors','trial errors','numeric','count',0::numeric,NULL::text,NULL::text,false),
 ('experiments','hick','input_mode','input mode','text',NULL,NULL::numeric,NULL::text,NULL::text,false)
)
INSERT INTO learning.definicion_metrica(actividad_version_id,codigo,nombre,tipo_valor,unidad,minimo,formula,version_formula,derivada)
SELECT av.actividad_version_id,s.codigo,s.nombre,s.tipo_valor,s.unidad,s.minimo,s.formula,s.version_formula,s.derivada
FROM metric_seed s JOIN learning.modulo m ON m.codigo=s.module_code JOIN learning.actividad a ON a.modulo_id=m.modulo_id AND a.codigo=s.activity_code
JOIN learning.actividad_version av ON av.actividad_id=a.actividad_id
ON CONFLICT(actividad_version_id,codigo) DO NOTHING;
