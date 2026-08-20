/**
 * Run every differential-test scenario through OUR federal T2 engine and print the
 * jacket lines we'd file, so they can be diffed against AuraTax's computed numbers.
 * Run:  npx tsx scripts/validate/run.ts
 */
import { computeFederalT2 } from '@classytic/ca-tax/t2';
import { SCENARIOS } from './scenarios.js';

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

const rows: Record<string, unknown>[] = [];

for (const s of SCENARIOS) {
  const r = computeFederalT2(s.input);
  const provincialTax = r.provincial?.provincialTax ?? r.provincialAllocation?.totalProvincialTax ?? 0;
  const out = {
    netIncomeForTax: r.netIncomeForTax,
    taxableIncome: r.taxableIncome,
    reducedBusinessLimit: r.businessLimit.reducedBusinessLimit,
    sbdIncome: r.sbd.sbdIncome,
    sbdAmount: r.sbd.sbdAmount,
    partIBasicTax: r.partI.basicTax,
    abatement: r.partI.abatement,
    generalRateReduction: r.partI.generalRateReduction,
    partITax: r.partI.partITaxPayable,
    partIVTax: r.part4Rdtoh.partIvTax,
    provincialTax,
    totalFederalTax: r.totalFederalTax,
    totalTax: r.totalTax,
  };
  rows.push({ id: s.id, ...out });

  console.log(`\n━━ ${s.id} — ${s.title}`);
  console.log(`   AuraTax entry: ${s.auraTaxEntry}`);
  console.log(`   Net income for tax (300)   ${money(out.netIncomeForTax)}`);
  console.log(`   Taxable income (360)       ${money(out.taxableIncome)}`);
  console.log(`   Reduced business limit     ${money(out.reducedBusinessLimit)}`);
  console.log(`   SBD income                 ${money(out.sbdIncome)}`);
  console.log(`   SBD (430)                  ${money(out.sbdAmount)}`);
  console.log(`   Part I basic tax (550)     ${money(out.partIBasicTax)}`);
  console.log(`   Federal abatement (608)    ${money(out.abatement)}`);
  console.log(`   General rate reduction     ${money(out.generalRateReduction)}`);
  console.log(`   Part I tax payable (700)   ${money(out.partITax)}`);
  if (out.partIVTax) console.log(`   Part IV tax (712)          ${money(out.partIVTax)}`);
  console.log(`   Provincial tax             ${money(out.provincialTax)}`);
  console.log(`   Total federal tax          ${money(out.totalFederalTax)}`);
  console.log(`   TOTAL TAX PAYABLE (770)    ${money(out.totalTax)}`);
}

console.log('\n\n=== JSON (for the diff harness) ===');
console.log(JSON.stringify(rows, null, 2));
