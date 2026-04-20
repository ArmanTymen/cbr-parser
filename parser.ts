import fetch, { Response } from 'node-fetch'
import * as XLSX from 'xlsx'
import * as fs from 'fs'

interface CBRData {
  metadata: {
    source: string
    updatedAt: string
  }
  current: {
    period: string
    keyRate: number | null
    inflation: number | null
  }
  previous: {
    keyRate: number | null
    inflation: number | null
  }
  changes: {
    keyRate: number | null
    inflation: number | null
  }
  yearlyMaxRates: YearlyMaxRate[]
}

interface YearlyMaxRate {
  year: number
  maxKeyRate: number | null
  period: string
}

function safeNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function round(value: number | null, digits = 2): number | null {
  return value !== null ? Number(value.toFixed(digits)) : null
}

function normalizeRate(value: number | null): number | null {
  if (value === null) return null

  // если уже доля
  if (value > 0 && value < 1) return value

  // если проценты
  return value / 100
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

function analyzeMaxRatesByYear(raw: unknown[][]): YearlyMaxRate[] {
  const yearlyData = new Map<number, { rate: number; period: string }>()

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i]
    if (!row || row.length < 2) continue

    const rawPeriod = safeNumber(row[0])
    const rawRate = safeNumber(row[1])

    if (rawPeriod === null || rawRate === null) continue

    // Пропускаем сырое значение через нормализацию (2100 -> 21)
    const rate = normalizeRate(rawRate)

    // Если после нормализации получили null, пропускаем итерацию
    if (rate === null) continue

    const month = Math.floor(rawPeriod)
    const year = Math.round((rawPeriod - month) * 10000)

    const existing = yearlyData.get(year)

    if (!existing || rate > existing.rate) {
      yearlyData.set(year, {
        rate,
        period: `${year}-${String(month).padStart(2, '0')}`
      })
    }
  }

  return Array.from(yearlyData.entries())
    .map(([year, data]) => ({
      year,
      maxKeyRate: round(data.rate, 2),
      period: data.period
    }))
    .sort((a, b) => a.year - b.year)
}

async function parseCBR(): Promise<CBRData> {
  const today = new Date()
  const toDate = `${today.getDate().toString().padStart(2, '0')}.${(
    today.getMonth() + 1
  ).toString().padStart(2, '0')}.${today.getFullYear()}`

  const url =
    `https://www.cbr.ru/hd_base/infl/?UniDbQuery.Posted=True` +
    `&UniDbQuery.From=01.01.2015` +
    `&UniDbQuery.To=${toDate}` +
    `&UniDbQuery.Format=Excel`

  const response: Response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Network error: ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]

  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  const latest = raw[1]
  const prev = raw[2]

  if (!latest || latest.length < 3) {
    throw new Error('No valid data')
  }

  const rawPeriod = safeNumber(latest[0])
  const month = rawPeriod ? Math.floor(rawPeriod) : 0
  const year = rawPeriod ? Math.round((rawPeriod - month) * 10000) : 0

  const period = `${year}-${String(month).padStart(2, '0')}`

  const keyRateRaw = safeNumber(latest[1])
  const inflationRaw = safeNumber(latest[2])

  const keyRate = normalizeRate(keyRateRaw)
  const inflation = normalizeRate(inflationRaw)

  const prevKeyRate = normalizeRate(safeNumber(prev?.[1]))
  const prevInflation = normalizeRate(safeNumber(prev?.[2]))

  const keyRateChange =
    keyRate !== null && prevKeyRate !== null
      ? round(keyRate - prevKeyRate)
      : null

  const inflationChange =
    inflation !== null && prevInflation !== null
      ? round(inflation - prevInflation)
      : null

  const yearlyMaxRates = analyzeMaxRatesByYear(raw)

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
    },
    yearlyMaxRates
  }
}

async function run(): Promise<void> {
  const MAX_RETRIES = 5
  const INITIAL_DELAY = 300000

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      console.log(`Run ${i + 1}`)

      const data = await parseCBR()

      fs.writeFileSync('data.json', JSON.stringify(data, null, 2))

      console.log('\n📊 Current:')
      console.table(data.current)

      console.log('\n📈 Yearly max rates:')
      console.table(
        data.yearlyMaxRates.map(x => ({
          Year: x.year,
          Rate: x.maxKeyRate,
          Period: x.period
        }))
      )

      console.log('\n📋 Summary:')
      data.yearlyMaxRates.forEach(x => {
        console.log(`${x.year}: ${x.maxKeyRate}% (${x.period})`)
      })

      return
    } catch (e) {
      console.error(`Attempt ${i + 1} failed:`, e)

      if (i < MAX_RETRIES - 1) {
        await delay(INITIAL_DELAY * (i + 1))
      } else {
        process.exit(1)
      }
    }
  }
}

run()