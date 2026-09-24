


--------------------QUERY WB:
SELECT
  pairing_id                       AS trip,
  pairing_start_date               AS fecha_inicio_trip,
  flight_start_date_local_time     AS inicio_vuelo_lt,
  flight_month_description         AS mes,
  duty_calendar_day_number         AS dia_duty,
  flight_number                    AS vuelo,
  departure_airport_code           AS dep,
  arrival_airport_code             AS arr,
  flight_departure_time_crew_base  AS std_hb,
  flight_arrival_hour_block_time   AS sta_hb,
  flight_block_time                AS hbt,
  subfleet_code                    AS sub_fleet,
  is_crew_passenger                AS pax,
  duty_presentation_date_at        AS presentacion_duty_date_lt   -- ⚠️ aún sin confirmar

FROM `operations-data-prod.carmen_gold.crew_pairing_carmen_system`

WHERE
  flight_start_date_local_time BETWEEN DATE '2025-09-01' AND DATE '2026-09-30'
  AND subsidiary_code IN ('LP')
  AND load_type_code = 'FP'
  AND crew_range_type_code = 'SAB'
  AND subfleet_code IN ('762', '788', '789')   -- WB: B767 y B787

QUALIFY
  CASE
    WHEN load_type_code = 'FP' AND
         DATE(ingestion_datetime) = MAX(CASE WHEN load_type_code = 'FP' THEN DATE(ingestion_datetime) END)
           OVER (PARTITION BY subsidiary_code, fleet_type_code, crew_range_type_code,
                              reference_month_number, reference_year)
      THEN 0
    WHEN load_type_code = 'ES' AND
         MAX(CASE WHEN load_type_code = 'FP' THEN 0 ELSE 0 END)
           OVER (PARTITION BY subsidiary_code, fleet_type_code, crew_range_type_code,
                              reference_month_number, reference_year) = -1 AND
         DATE(ingestion_datetime) = MAX(CASE WHEN load_type_code = 'ES' THEN DATE(ingestion_datetime) END)
           OVER (PARTITION BY subsidiary_code, fleet_type_code, crew_range_type_code,
                              reference_month_number, reference_year)
      THEN 0
    ELSE -1
  END = 0

ORDER BY pairing_id ASC;

