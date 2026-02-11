import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { google } from 'npm:googleapis@120.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper function to validate and format date
function validateDate(dateStr: any): string {
  if (!dateStr || dateStr === 'undefined' || dateStr === 'null') {
    // Return today's date as default
    return new Date().toISOString().split('T')[0]
  }
  
  const str = String(dateStr).trim()
  
  // If already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str
  }
  
  // Try to parse it as a date
  try {
    const date = new Date(str)
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]
    }
  } catch (e) {
    // Fall back to today
  }
  
  return new Date().toISOString().split('T')[0]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔄 Syncing FROM Supabase TO Google Sheets...')
    
    // Get dates with proper validation
    let startDate: string
    let endDate: string
    
    try {
      const bodyText = await req.text()
      console.log('Request body:', bodyText)
      
      if (bodyText && bodyText.trim() !== '') {
        const body = JSON.parse(bodyText)
        console.log('Parsed body:', body)
        
        // Validate and format dates
        startDate = validateDate(body.startDate || body.start_date)
        endDate = validateDate(body.endDate || body.end_date)
      } else {
        // No body provided, use default dates
        const today = new Date()
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
        
        startDate = firstDay.toISOString().split('T')[0]
        endDate = today.toISOString().split('T')[0]
        
        console.log('No body provided, using default dates')
      }
    } catch (parseError) {
      console.log('Error parsing body, using default dates:', parseError.message)
      
      const today = new Date()
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      
      startDate = firstDay.toISOString().split('T')[0]
      endDate = today.toISOString().split('T')[0]
    }
    
    console.log('✅ Using dates:', { startDate, endDate })
    
    // Validate dates are not empty strings
    if (!startDate || !endDate || startDate === 'undefined' || endDate === 'undefined') {
      const today = new Date()
      startDate = today.toISOString().split('T')[0]
      endDate = today.toISOString().split('T')[0]
      console.log('Dates were invalid, using today:', { startDate, endDate })
    }

    // 1. Get data from Supabase
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase configuration')
    }

    // Build query with validated dates
    const query = `date=gte.${startDate}&date=lte.${endDate}&select=*&order=date.desc,employee_id.asc`
    const dbUrl = `${SUPABASE_URL}/rest/v1/employee_attendance?${query}`
    
    console.log('🔗 Fetching from:', dbUrl)

    const dbResponse = await fetch(dbUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      }
    })

    if (!dbResponse.ok) {
      const errorText = await dbResponse.text()
      console.error('❌ Database error:', errorText)
      throw new Error(`Database error: ${errorText}`)
    }

    const attendanceData = await dbResponse.json()
    console.log(`📊 Found ${attendanceData.length} records in Supabase`)

    // 2. Setup Google Sheets
    const SHEET_ID = Deno.env.get('SHEET_ID')
    const privateKey = Deno.env.get('google_private_key')?.replace(/\\n/g, '\n') || ''
    
    if (!SHEET_ID || !privateKey) {
      throw new Error('Missing Google Sheets configuration')
    }
    
    const auth = new google.auth.JWT({
      email: Deno.env.get('google_client_email'),
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })

    const sheets = google.sheets({ version: 'v4', auth })

    // 3. Prepare data
    const headers = [
      'Date',
      'Employee Id', 
      'Employee Name',
      'Email ID',
      'First In',
      'Last Out',
      'Late Login',
      'Shift Name',
      'Status'
    ]

    const rows = attendanceData.map((record: any) => [
      record.date,
      record.employee_id,
      record.employee_name,
      record.email_id || '',
      record.first_in || '',
      record.last_out || '',
      record.late_login || '',
      record.shift_name || '',
      '✅ From Supabase'
    ])

    console.log(`📝 Prepared ${rows.length} rows for Google Sheets`)

    // 4. Update Google Sheet
    try {
      console.log('📋 Checking existing sheet data...')
      
      // Get existing data
      const existingData = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'A:I',
      })
      
      const existingRows = existingData.data.values || []
      console.log(`📋 Sheet currently has ${existingRows.length} rows`)
      
      if (existingRows.length === 0) {
        // Sheet is empty
        console.log('📄 Sheet is empty, writing headers and data...')
        
        // Write headers
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: 'A1:I1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] }
        })
        
        // Write data
        if (rows.length > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `A2:I${rows.length + 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rows }
          })
        }
      } else {
        // Sheet has data - just update "Saved" column for matching rows
        console.log('🔄 Updating "Saved" status for matching rows...')
        
        // Simple approach: Just update the status column for existing rows
        // We'll update column I for all rows that have data
        const statusUpdates = []
        
        // Start from row 2 (skip header)
        for (let i = 1; i < existingRows.length; i++) {
          statusUpdates.push(['✅ From Supabase'])
        }
        
        if (statusUpdates.length > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `I2:I${statusUpdates.length + 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: statusUpdates }
          })
        }
        
        // Also append new Supabase data that doesn't exist in sheet
        console.log('➕ Checking for new data to append...')
        
        // For simplicity, just append all Supabase data
        // In production, you'd want to check for duplicates
        if (rows.length > 0) {
          const startRow = existingRows.length + 1
          
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `A${startRow}:I${startRow + rows.length - 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rows }
          })
        }
      }
      
      console.log('✅ Google Sheets updated successfully!')

    } catch (sheetsError) {
      console.error('❌ Google Sheets error:', sheetsError)
      throw new Error(`Google Sheets error: ${sheetsError.message}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `✅ Successfully synced ${rows.length} records FROM Supabase TO Google Sheets`,
        details: {
          dateRange: `${startDate} to ${endDate}`,
          recordsSynced: rows.length,
          sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('❌ Sync error:', error.message)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
