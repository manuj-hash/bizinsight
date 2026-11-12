-- Add supporting indexes for foreign-key columns flagged by Supabase advisors.
-- Existing indexes are preserved; only missing left-prefix indexes are created.
DO $$
DECLARE
  fk record;
  index_name text;
  column_list text;
BEGIN
  FOR fk IN
    SELECT
      c.oid AS constraint_oid,
      ns.nspname AS schema_name,
      tbl.relname AS table_name,
      c.conrelid AS table_oid,
      c.conkey AS key_columns
    FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE c.contype = 'f'
      AND ns.nspname IN ('public', 'private')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND i.indisready
          AND i.indpred IS NULL
          AND i.indexprs IS NULL
          AND i.indnkeyatts >= cardinality(c.conkey)
          AND (SELECT array_agg(i.indkey[k]::smallint ORDER BY k)\n               FROM generate_series(0, cardinality(c.conkey)-1) AS g(k)) = c.conkey
      )
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ordinality)
      INTO column_list
    FROM unnest(fk.key_columns) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = fk.table_oid
     AND a.attnum = k.attnum;

    index_name := left(
      'idx_' || fk.table_name || '_' || fk.constraint_oid::text || '_fk',
      63
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
      index_name,
      fk.schema_name,
      fk.table_name,
      column_list
    );
  END LOOP;
END $$;
