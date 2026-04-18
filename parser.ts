import fetch, { Response } from 'node-fetch';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

/**
 * Интерфейсы данных
 */
interface CBRData {
  metadata: {
    source: string;
    updatedAt: string;
  };
  current: {
    period: string;
    keyRate: number | null;
    inflation: number | null;
  };
  previous: {
    keyRate: number | null;
    inflation: number | null;
  };
  changes: {
    keyRate: number | null;
    inflation: number | null;
  };
}

/**
 * Вспомогательные функции
 */
function safeNumber(value: unknown): number | null {
  const num = Number(value);
  return typeof num === 'number' && !isNaN(num) ? num : null;
}

function round(value: number | null, digits: number = 2): number | null {
  return value !== null ? Number(value.toFixed(digits)) : null;
}

const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * Основная логика парсинга
 */
async function parseCBR(): Promise<CBRData> {
  const today: Date = new Date();
  const toDate: string = `${today.getDate().toString().padStart(2, '0')}.${(
    today.getMonth() + 1
  ).toString().padStart(2, '0')}.${today.getFullYear()}`;

  const url: string =
    `https://www.cbr.ru/hd_base/infl/?UniDbQuery.Posted=True` +
    `&UniDbQuery.From=01.01.2025` +
    `&UniDbQuery.To=${toDate}` +
    `&UniDbQuery.Format=Excel`;

  const response: Response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CBR Network response was not ok: ${response.statusText}`);
  }

  const buffer: ArrayBuffer = await response.arrayBuffer();
  const workbook: XLSX.WorkBook = XLSX.read(buffer, { type: 'array' });
  const sheetName: string = workbook.SheetNames[0];
  const sheet: XLSX.WorkSheet = workbook.Sheets[sheetName];
  
  // Типизируем массив как массив массивов любого типа (unknown)
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const latest: unknown[] | undefined = raw?.[1];
  const prev: unknown[] | undefined = raw?.[2];

  if (!latest || latest.length < 3) {
    throw new Error('No valid data rows found in CBR Excel');
  }

  // Парсинг периода (ЦБ использует формат Month.Year в первой колонке)
  const rawPeriod: number = Number(latest[0]);
  const monthIndex: number = Math.floor(rawPeriod);
  const year: number = Math.round((rawPeriod - monthIndex) * 10000);
  const period: string = `${year}-${String(monthIndex).padStart(2, '0')}`;

  const keyRate: number | null = safeNumber(latest[1]) ? (safeNumber(latest[1])! / 100) : null;
  const inflation: number | null = safeNumber(latest[2]) ? (safeNumber(latest[2])! / 100) : null;

  const prevKeyRate: number | null = prev ? (safeNumber(prev[1]) ? safeNumber(prev[1])! / 100 : null) : null;
  const prevInflation: number | null = prev ? (safeNumber(prev[2]) ? safeNumber(prev[2])! / 100 : null) : null;

  const keyRateChange: number | null =
    keyRate !== null && prevKeyRate !== null ? round(keyRate - prevKeyRate) : null;

  const inflationChange: number | null =
    inflation !== null && prevInflation !== null ? round(inflation - prevInflation) : null;

  return {
    metadata: {
      source: 'CBR',
      updatedAt: toDate,
    },
    current: {
      period,
      keyRate,
      inflation,
    },
    previous: {
      keyRate: prevKeyRate,
      inflation: prevInflation,
    },
    changes: {
      keyRate: keyRateChange,
      inflation: inflationChange,
    },
  };
}

/**
 * Точка входа с логикой повторов
 */
async function run(): Promise<void> {
  const MAX_RETRIES: number = 5;
  const INITIAL_DELAY_MS: number = 300000; // 5 минут

  for (let i: number = 0; i < MAX_RETRIES; i++) {
    try {
      console.log(`Execution attempt ${i + 1}...`);
      const data: CBRData = await parseCBR();

      // Валидация: если данные не обновились (например, ставка null), считаем попытку неудачной
      if (data.current.keyRate === null) {
        throw new Error('Key rate data is missing in the source');
      }

      fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
      
      console.log('--- Successful Update ---');
      console.table(data.current);
      return; 

    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`Attempt ${i + 1} failed: ${errorMessage}`);

      if (i < MAX_RETRIES - 1) {
        // Увеличиваем ожидание с каждой попыткой: 5мин, 10мин, 15мин...
        const nextDelay: number = INITIAL_DELAY_MS * (i + 1);
        console.log(`Retrying in ${nextDelay / 60000} minutes...`);
        await delay(nextDelay);
      } else {
        console.error('All retries exhausted. Workflow failed.');
        process.exit(1);
      }
    }
  }
}

run();