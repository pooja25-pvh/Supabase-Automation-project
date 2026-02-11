-- Function to get attendance by date range
CREATE OR REPLACE FUNCTION get_attendance_by_date(
  start_date DATE,
  end_date DATE
)
RETURNS TABLE (
  attendance_date DATE,
  employee_id TEXT,
  employee_name TEXT,
  email_id TEXT,
  first_in TEXT,
  last_out TEXT,
  late_login TEXT,
  shift_name TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ea.date as attendance_date,
    ea.employee_id,
    ea.employee_name,
    ea.email_id,
    TO_CHAR(ea.first_in, 'HH24:MI:SS') as first_in,
    TO_CHAR(ea.last_out, 'HH24:MI:SS') as last_out,
    TO_CHAR(ea.late_login, 'HH24:MI:SS') as late_login,
    ea.shift_name
  FROM employee_attendance ea
  WHERE ea.date BETWEEN start_date AND end_date
  ORDER BY ea.date DESC, ea.employee_id;
END;
$$;
