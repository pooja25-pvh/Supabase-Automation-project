-- Table for storing employee attendance data
CREATE TABLE employee_attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  email_id TEXT,
  first_in TIME,
  last_out TIME,
  late_login TIME,
  shift_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table for storing Google Sheets configuration
CREATE TABLE sheets_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id TEXT NOT NULL,
  sheet_name TEXT DEFAULT 'Attendance',
  service_account_key JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
