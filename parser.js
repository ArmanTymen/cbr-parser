import fetch from 'node-fetch'
import * as XLSX from 'xlsx'
import fs from 'fs'

async function parseCBR() {
  const today = new Date()
  const toDate = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth() + 1).toString().padStart(2, '0')}.${today.getFullYear()}`

  const url = `https://www.cbr.ru/hd_base/infl/?UniDbQuery.Posted=True&UniDbQuery.From=01.01.2025&UniDbQuery.To=${toDate}&UniDbQuery.Format=Excel`

  const response = await fetch(url)
  const buffer = await response.arrayBuffer()

  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  const latest = raw[1]

  const dateNum = parseFloat(latest[0])
  const month = Math.floor(dateNum)
  const year = Math.round((dateNum - month) * 10000)
  const date = `${year}-${String(month).padStart(2, '0')}-01`

  const keyRate = latest[1] / 100
  const inflation = latest[2] / 100

  const prev = raw[2]
  const prevKeyRate = prev ? prev[1] / 100 : null

  const result = {
    current: { date, keyRate, inflation },
    previousKeyRate: prevKeyRate,
    keyRateChange: prevKeyRate ? keyRate - prevKeyRate : null,
    source: `ЦБ РФ, ${toDate}`
  }

  return result
}

async function run() {
  const data = await parseCBR()

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2))

  console.log('Data updated:', data)
}

run()