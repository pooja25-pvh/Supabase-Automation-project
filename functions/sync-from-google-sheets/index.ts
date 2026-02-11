import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { google } from 'npm:googleapis@120.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔄 Starting sync FROM Google Sheets TO Supabase...')

    // Get environment variables
    const SHEET_ID = Deno.env.get('SHEET_ID')
    const clientEmail = Deno.env.get('google_client_email')
    const privateKey = Deno.env.get('google_private_key')?.replace(/\\n/g, '\n') || ''
    
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
    
    if (!SHEET_ID || !clientEmail || !privateKey || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing required environment variables')
    }

    // 1. Read data from Google Sheets (NOW 9 COLUMNS A:I)
    console.log('📖 Reading data from Google Sheets (A:I)...')
    
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    
    const sheets = google.sheets({ version: 'v4', auth })
    
    // Read 9 columns (A:I) - column I is the "Saved" column
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'A:I', // CHANGED FROM A:H TO A:I
    })
    
    const rows = response.data.values || []
    console.log(`📊 Found ${rows.length} rows in Google Sheets`)
    
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No data found in Google Sheets',
          synced: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }
    
    // Show first few rows for debugging
    console.log('Sample rows from sheet:')
    rows.slice(0, 3).forEach((row, i) => {
      console.log(`Row ${i}:`, row)
    })
    
    // Skip header row (row 0)
    const dataRows = rows.slice(1)
    console.log(`📝 Processing ${dataRows.length} data rows`)
    
    // 2. Transform Google Sheets data
    const attendanceRecords = dataRows
      .map((row: string[], index: number) => {
        try {
          // Ensure we have at least 9 columns (pad if needed)
          const paddedRow = [...row, ...Array(9 - row.length).fill('')]
          
          // Parse and convert each field
          const rawDate = paddedRow[0]?.trim() || ''
          const rawFirstIn = paddedRow[4]?.trim() || ''
          const rawLateLogin = paddedRow[6]?.trim() || ''
          
          const record = {
            date: parseDate(rawDate),
            employee_id: paddedRow[1]?.trim() || '',
            employee_name: paddedRow[2]?.trim() || '',
            email_id: paddedRow[3]?.trim() || '',
            first_in: parseTime(rawFirstIn),
            last_out: parseTime(paddedRow[5]?.trim() || ''),
            late_login: parseTime(rawLateLogin),
            shift_name: paddedRow[7]?.trim() || '',
            // Column I (index 8) is the "Saved" column - we'll update it later
          }
          
          console.log(`Row ${index + 2}:`, {
            rawDate,
            parsedDate: record.date,
            rawFirstIn,
            parsedFirstIn: record.first_in,
            rawLateLogin,
            parsedLateLogin: record.late_login
          })
          
          return record
        } catch (error) {
          console.error(`Error parsing row ${index + 2}:`, error)
          return null
        }
      })
      .filter(record => {
        if (!record) return false
        
        // Only include rows with essential data
        const hasDate = record.date && record.date.trim().length > 0
        const hasEmployeeId = record.employee_id && record.employee_id.trim().length > 0
        const hasEmployeeName = record.employee_name && record.employee_name.trim().length > 0
        
        return hasDate && hasEmployeeId && hasEmployeeName
      })
    
    console.log(`✅ Validated ${attendanceRecords.length} records`)
    
    if (attendanceRecords.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No valid data to sync',
          synced: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }
    
    // 3. Clear existing data in Supabase
    console.log('🧹 Clearing existing attendance data in Supabase...')
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/employee_attendance`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal'
        }
      })
    } catch (error) {
      console.warn('Could not clear table:', error.message)
    }
    
    // 4. Insert new data into Supabase
    console.log('📤 Inserting data into Supabase...')
    const batchSize = 10
    let insertedCount = 0
    let failedRows: number[] = []
    
    for (let i = 0; i < attendanceRecords.length; i += batchSize) {
      const batch = attendanceRecords.slice(i, i + batchSize)
      const batchNumber = Math.floor(i/batchSize) + 1
      
      const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/employee_attendance`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(batch)
      })
      
      if (insertResponse.ok) {
        insertedCount += batch.length
        console.log(`✅ Batch ${batchNumber} inserted (${batch.length} records)`)
      } else {
        const errorText = await insertResponse.text()
        console.error(`❌ Batch ${batchNumber} failed:`, errorText)
        
        // Mark which rows failed
        for (let j = i; j < Math.min(i + batchSize, attendanceRecords.length); j++) {
          failedRows.push(j + 2) // +2 because: +1 for header, +1 for 0-based index
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    // 5. UPDATE GOOGLE SHEETS WITH "SAVED" STATUS IN COLUMN I
    console.log('📝 Updating "Saved" status in Google Sheets column I...')
    
    // Prepare status updates for column I
    // Row 1: Header should already be "Saved"
    // Rows 2+: Update with status
    const statusUpdates = []
    
    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2 // +2 because rows are 1-indexed and we skip header
      
      if (failedRows.includes(rowNumber)) {
        statusUpdates.push(['❌ Failed'])
      } else if (i < insertedCount) {
        statusUpdates.push(['✅ Saved'])
      } else {
        statusUpdates.push(['']) // Empty for rows beyond what we processed
      }
    }
    
    // Update column I (9th column) starting from row 2
    if (statusUpdates.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `I2:I${statusUpdates.length + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: statusUpdates }
      })
      console.log(`✅ Updated "Saved" status for ${statusUpdates.length} rows`)
    }
    
    // 6. Verify count in Supabase
    console.log('🔍 Verifying data in Supabase...')
    const verifyResponse = await fetch(`${SUPABASE_URL}/rest/v1/employee_attendance?select=count`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'count=exact'
      }
    })
    
    const countHeader = verifyResponse.headers.get('content-range')
    const totalInDB = countHeader ? countHeader.split('/')[1] : '0'
    
    console.log(`🎉 Sync completed!`)
    console.log(`   - Processed: ${dataRows.length} rows from Google Sheets`)
    console.log(`   - Validated: ${attendanceRecords.length} records`)
    console.log(`   - Inserted: ${insertedCount} records into Supabase`)
    console.log(`   - Failed: ${failedRows.length} rows`)
    console.log(`   - Total in Supabase: ${totalInDB} records`)
    
    return new Response(
      JSON.stringify({
        success: insertedCount > 0,
        message: insertedCount > 0 
          ? `✅ Successfully synced ${insertedCount} records FROM Google Sheets TO Supabase`
          : '⚠️ No records were inserted',
        details: {
          totalRowsInSheet: dataRows.length,
          validatedRecords: attendanceRecords.length,
          insertedRecords: insertedCount,
          failedRows: failedRows.length > 0 ? failedRows : undefined,
          totalInSupabase: totalInDB,
          updatedSavedColumn: true
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: insertedCount > 0 ? 200 : 500
      }
    )

  } catch (error) {
    console.error('❌ Sync from Google Sheets failed:', error)
    
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

// Helper function to convert date formats like "16 Dec 25" to "2025-12-16"
function parseDate(dateStr: string): string {
  if (!dateStr || dateStr.trim() === '') return ''
  
  const str = dateStr.trim()
  
  // If already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  
  // Try to parse "16 Dec 25" format
  const match = str.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/)
  if (match) {
    const [_, day, month, year] = match
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthIndex = monthNames.findIndex(m => m.toLowerCase() === month.toLowerCase().substring(0, 3))
    
    if (monthIndex !== -1) {
      const fullYear = year.length === 2 ? `20${year}` : year
      const formattedMonth = (monthIndex + 1).toString().padStart(2, '0')
      const formattedDay = day.padStart(2, '0')
      return `${fullYear}-${formattedMonth}-${formattedDay}`
    }
  }
  
  return str // Return as-is if can't parse
}

// Helper function to convert time formats
function parseTime(timeStr: string): string | null {
  if (!timeStr || timeStr.trim() === '' || timeStr === '-' || timeStr.toLowerCase() === 'null') {
    return null
  }
  
  const str = timeStr.trim()
  
  // Handle negative times (like "-0:20:00")
  if (str.startsWith('-')) {
    console.log(`⚠️ Skipping negative time: ${str}`)
    return null
  }
  
  // Handle "9:51 pm" format
  if (str.toLowerCase().includes('am') || str.toLowerCase().includes('pm')) {
    try {
      const timeMatch = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i)
      if (timeMatch) {
        let [_, hour, minute, ampm] = timeMatch
        let hourNum = parseInt(hour)
        
        if (ampm.toLowerCase() === 'pm' && hourNum < 12) {
          hourNum += 12
        } else if (ampm.toLowerCase() === 'am' && hourNum === 12) {
          hourNum = 0
        }
        
        return `${hourNum.toString().padStart(2, '0')}:${minute}:00`
      }
    } catch (e) {
      console.log(`Could not parse AM/PM time: ${str}`)
    }
  }
  
  // Handle HH:MM:SS or HH:MM format
  if (str.includes(':')) {
    const parts = str.split(':')
    if (parts.length >= 2) {
      const hour = parts[0].padStart(2, '0')
      const minute = parts[1].padStart(2, '0')
      const second = parts[2] ? parts[2].padStart(2, '0') : '00'
      
      // Validate
      const hourNum = parseInt(hour)
      const minuteNum = parseInt(minute)
      const secondNum = parseInt(second)
      
      if (hourNum >= 0 && hourNum <= 23 && 
          minuteNum >= 0 && minuteNum <= 59 && 
          secondNum >= 0 && secondNum <= 59) {
        return `${hour}:${minute}:${second}`
      }
    }
  }
  
  console.log(`⚠️ Invalid time format: ${str}`)
  return null
}
