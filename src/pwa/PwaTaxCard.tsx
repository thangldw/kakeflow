import { useState } from 'react'
import { localize } from '../i18n'
import { TaxSupportPanel } from '../features/reports/TaxSupportPanel'
import { tokyoDate } from '../features/simple/homeMath'
import type { PwaLedgerClient } from '../platform/pwa/client'
import { downloadCsv, loadPwaTaxTransactions } from './pwaTax'

/** 確定申告 candidates for one year, from the encrypted vault; the CSV is downloaded, nothing leaves the device. */
export function PwaTaxCard({ client, householdId }: { readonly client: PwaLedgerClient; readonly householdId: string }) {
  const thisYear = Number(tokyoDate().slice(0, 4))
  const [year, setYear] = useState(String(thisYear))
  const years = [thisYear, thisYear - 1, thisYear - 2].map(String)
  return <div className="simple-card pwa-tax-card">
    <label>{localize("対象の年")}
      <select value={year} onChange={(event) => setYear(event.target.value)}>
        {years.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <TaxSupportPanel key={year} year={year} loadYear={() => loadPwaTaxTransactions(client, householdId)} onSaveCsv={downloadCsv} />
  </div>
}
