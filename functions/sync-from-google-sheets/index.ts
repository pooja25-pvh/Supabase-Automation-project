import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { google } from 'npm:googleapis@120.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  
  return str
}

// Helper function to convert time formats like "9:51 pm" to "21:51:00"
function parseTime(timeStr: string): string | null {
  if (!timeStr || timeStr.trim() === '' || timeStr === '-' || timeStr.toLowerCase() === 'null') {
    return null
  }
  
  const str = timeStr.trim()
  
  // Handle negative times (like "-0:20:00")
  if (str.startsWith('-')) {
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
    } catch (e) {}
  }
  
  // Handle HH:MM:SS or HH:MM format
  if (str.includes(':')) {
    const parts = str.split(':')
    if (parts.length >= 2) {
      const hour = parts[0].padStart(2, '0')
      const minute = parts[1].padStart(2, '0')
      const second = parts[2] ? parts[2].padStart(2, '0') : '00'
      
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
  
  return null
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

    // 1. Read data from Google Sheets
    console.log('📖 Reading data from Google Sheets...')
    
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    
    const sheets = google.sheets({ version: 'v4', auth })
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'A:I',
    })
    
    const rows = response.data.values || []
    console.log(`📊 Found ${rows.length} rows in Google Sheets`)
    
    if (rows.length <= 1) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No data to sync',
          synced: 0
        })
      )
    }
    
    // Skip header row
    const dataRows = rows.slice(1)
    
    // 2. Get ALL existing sheet_row_numbers from Supabase
    console.log('🔍 Fetching existing row numbers from Supabase...')
    
    const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/employee_attendance?select=sheet_row_number`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      }
    })
    
    if (!existingResponse.ok) {
      console.error('Failed to fetch existing records:', await existingResponse.text())
      throw new Error('Could not fetch existing records')
    }
    
    // FIX: Properly handle the response
    const responseText = await existingResponse.text()
    let existingRecords = []
    
    try {
      existingRecords = JSON.parse(responseText)
      // Ensure it's an array
      if (!Array.isArray(existingRecords)) {
        console.log('Response is not an array, converting to array')
        existingRecords = existingRecords ? [existingRecords] : []
      }
    } catch (e) {
      console.error('Failed to parse response:', e.message)
      existingRecords = []
    }
    
    // Create a Set of existing sheet row numbers that have already been synced
    const syncedRows = new Set()
    existingRecords.forEach((record: any) => {
      if (record && record.sheet_row_number) {
        syncedRows.add(record.sheet_row_number)
      }
    })
    
    console.log(`📋 Found ${syncedRows.size} previously synced rows in Supabase`)
    
    // 3. Process rows and find ONLY NEW rows (never synced before)
    console.log('📝 Processing rows...')
    
    const newRecords = []
    const rowStatus = [] // For Column I - always "✅ Saved" for all rows
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowNumber = i + 2 // Row number in Google Sheets (1-indexed + header)
      
      // Always show "✅ Saved" in column I
      rowStatus.push(['✅ Saved'])
      
      // Skip if this row has already been synced before
      if (syncedRows.has(rowNumber)) {
        console.log(`⏭️ Row ${rowNumber}: Already synced, skipping`)
        continue
      }
      
      try {
        // Ensure we have at least 8 columns (A-H)
        const paddedRow = [...row, ...Array(8 - row.length).fill('')]
        
        // Parse the data
        const date = parseDate(paddedRow[0]?.trim() || '')
        const employeeId = paddedRow[1]?.trim() || ''
        const employeeName = paddedRow[2]?.trim() || ''
        
        // Skip if missing required fields
        if (!date || !employeeId || !employeeName) {
          console.log(`⚠️ Row ${rowNumber}: Missing required fields, skipping`)
          continue
        }
        
        // This is a NEW row - add it to the insert batch
        console.log(`🆕 Row ${rowNumber}: NEW record - ${date} | ${employeeId}`)
        
        const record = {
          date,
          employee_id: employeeId,
          employee_name: employeeName,
          email_id: paddedRow[3]?.trim() || '',
          first_in: parseTime(paddedRow[4]?.trim() || ''),
          last_out: parseTime(paddedRow[5]?.trim() || ''),
          late_login: parseTime(paddedRow[6]?.trim() || ''),
          shift_name: paddedRow[7]?.trim() || '',
          sheet_row_number: rowNumber, // Store the row number
          sheet_synced_at: new Date().toISOString() // Store sync timestamp
        }
        
        newRecords.push(record)
        
      } catch (error) {
        console.error(`❌ Error parsing row ${rowNumber}:`, error)
      }
    }
    
    console.log(`✅ Found ${newRecords.length} new records to insert`)
    
    // 4. Update Google Sheets Column I with "✅ Saved" for all rows
    console.log('📝 Updating "Saved" status in Google Sheets column I...')
    
    if (rowStatus.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `I2:I${rowStatus.length + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rowStatus }
      })
      console.log(`✅ Updated status for ${rowStatus.length} rows`)
    }
    
    // 5. If no new records, exit early
    if (newRecords.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `✅ All records already synced. No new data to insert.`,
          details: {
            totalRows: dataRows.length,
            newRecords: 0,
            alreadySynced: syncedRows.size
          }
        })
      )
    }
    
    // 6. Insert ONLY new records in batches
    console.log('📤 Inserting new records into Supabase...')
    const batchSize = 10
    let insertedCount = 0
    
    for (let i = 0; i < newRecords.length; i += batchSize) {
      const batch = newRecords.slice(i, i + batchSize)
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
        console.log(`✅ Batch ${batchNumber}: Inserted ${batch.length} records`)
      } else {
        const errorText = await insertResponse.text()
        console.error(`❌ Batch ${batchNumber} failed:`, errorText)
      }
      
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    console.log(`🎉 Sync completed!`)
    console.log(`   - Total rows in sheet: ${dataRows.length}`)
    console.log(`   - Already synced rows: ${syncedRows.size}`)
    console.log(`   - New records inserted: ${insertedCount}`)
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `✅ Successfully synced ${insertedCount} new records to Supabase`,
        details: {
          totalRows: dataRows.length,
          alreadySynced: syncedRows.size,
          newRecords: insertedCount
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('❌ Sync failed:', error)
    
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
