import fetch from 'node-fetch'
import * as XLSX from 'xlsx'
import fs from 'fs'

function safeNumber(value) {
  return typeof value === 'number' && !isNaN(value) ? value : null
}

function round(value, digits = 2) {
  return value !== null ? Number(value.toFixed(digits)) : null
}

async function parseCBR() {
  const today = new Date()

  const toDate = `${today.getDate().toString().padStart(2, '0')}.${(
    today.getMonth() + 1
  )
    .toString()
    .padStart(2, '0')}.${today.getFullYear()}`

  const url =
    `https://www.cbr.ru/hd_base/infl/?UniDbQuery.Posted=True` +
    `&UniDbQuery.From=01.01.2025` +
    `&UniDbQuery.To=${toDate}` +
    `&UniDbQuery.Format=Excel`

  const response = await fetch(url)
  const buffer = await response.arrayBuffer()

  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  const latest = raw?.[1]
  const prev = raw?.[2]

  if (!latest) throw new Error('No data from CBR')

  const monthIndex = Math.floor(Number(latest[0]))
  const year = Math.round((Number(latest[0]) - monthIndex) * 10000)

  const period = `${year}-${String(monthIndex).padStart(2, '0')}`

  const keyRate = safeNumber(latest[1]) / 100
  const inflation = safeNumber(latest[2]) / 100

  const prevKeyRate = prev ? safeNumber(prev[1]) / 100 : null
  const prevInflation = prev ? safeNumber(prev[2]) / 100 : null

  const keyRateChange =
    prevKeyRate !== null ? round(keyRate - prevKeyRate) : null

  const inflationChange =
    prevInflation !== null ? round(inflation - prevInflation) : null

  return {
    metadata: {
      source: 'CBR',
      updatedAt: toDate
    },

    current: {
      period,
      keyRate,
      inflation
    },

    previous: {
      keyRate: prevKeyRate,
      inflation: prevInflation
    },

    changes: {
      keyRate: keyRateChange,
      inflation: inflationChange
    }
  }
}

async function run() {
  try {
    const data = await parseCBR()

    fs.writeFileSync('data.json', JSON.stringify(data, null, 2))

    console.log('Data updated successfully')
    console.log(data)
  } catch (e) {
    console.error('Parser error:', e)
  }
}

run()