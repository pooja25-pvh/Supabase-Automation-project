# Supabase ↔ Google Sheets Bidirectional Sync

Production-ready bidirectional synchronization between **Supabase
(PostgreSQL)** and **Google Sheets** for employee attendance management.

------------------------------------------------------------------------

## 🚀 Features

-   🔄 Google Sheets → Supabase sync\
-   🔄 Supabase → Google Sheets sync\
-   🛡 Duplicate prevention using sheet row tracking\
-   📅 Automatic date & time format conversion\
-   📊 Status tracking column (`✅ Saved`)\
-   ⏰ Cron-based automation support

------------------------------------------------------------------------

## 🏗 Architecture

Google Sheets ⇄ Supabase Edge Functions ⇄ Supabase PostgreSQL

-   `sync-from-google-sheets` → Inserts only new rows\
-   `sync-to-google-sheets` → Appends DB records to sheet

------------------------------------------------------------------------

## 🗄 Database Schema

``` sql
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
    sheet_row_number INTEGER,
    sheet_synced_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);
```

------------------------------------------------------------------------

## 🔧 Environment Variables

    SUPABASE_URL=your-project-url
    SUPABASE_ANON_KEY=your-anon-key
    SHEET_ID=your-google-sheet-id
    google_client_email=your-service-account-email
    google_private_key=your-private-key

------------------------------------------------------------------------

## 📡 API Endpoints

### Sync From Google Sheets

    POST /functions/v1/sync-from-google-sheets
    Authorization: Bearer SUPABASE_ANON_KEY

### Sync To Google Sheets

    POST /functions/v1/sync-to-google-sheets
    Authorization: Bearer SUPABASE_ANON_KEY
    Body:
    {
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD"
    }

------------------------------------------------------------------------

## ⏰ Automation (pg_cron)

``` sql
SELECT cron.schedule(
    'sync-google-sheets',
    '* * * * *',
    $$
    SELECT net.http_post(
        url := 'https://your-project.supabase.co/functions/v1/sync-from-google-sheets',
        headers := '{"Authorization":"Bearer YOUR_ANON_KEY"}'::jsonb,
        body := '{}'::jsonb
    );
    $$
);
```

------------------------------------------------------------------------

## 📌 Setup Steps

1.  Create Google Service Account\
2.  Enable Google Sheets API\
3.  Share Sheet with Service Account\
4.  Create Supabase project\
5.  Create table & deploy Edge Functions\
6.  Add environment variables\
7.  Test API endpoints

------------------------------------------------------------------------
<img width="5519" height="2487" alt="deepseek_mermaid_20260211_9ee234" src="https://github.com/user-attachments/assets/a2db4c44-328f-41a1-9cee-5350c88582e1" />

<img width="6243" height="8613" alt="deepseek_mermaid_20260211_e84a78" src="https://github.com/user-attachments/assets/e6a57dff-e6a3-4db0-bc74-f3e3d799847e" />

<img width="8245" height="3833" alt="deepseek_mermaid_20260211_d0328c" src="https://github.com/user-attachments/assets/de69b1f3-e8b1-439b-9dab-8b10b19d3d38" />

<img width="6053" height="2569" alt="deepseek_mermaid_20260211_bdc3db" src="https://github.com/user-attachments/assets/487c4e86-5bd4-4ed4-97f4-70c67d6265ee" />

<img width="2983" height="3187" alt="deepseek_mermaid_20260211_367833" src="https://github.com/user-attachments/assets/91d349a8-1c7a-459f-a9f8-ba73444ef7b7" />

<img width="5634" height="2256" alt="deepseek_mermaid_20260211_597a7a" src="https://github.com/user-attachments/assets/e7c34d27-b189-4ac4-bdd7-8e75506eaad7" />


## 📄 License

MIT License
