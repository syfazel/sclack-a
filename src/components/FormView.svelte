<script>
  import { setDocCustomFields } from '../lib/docs.js'
  import { faNum } from '../lib/extract.js'
  import {
    FORM_GUIDE_NOTES,
    FORM_SUBMIT_EMAIL,
    countRooyeshFields,
    formCompletion,
    validateFormPercents
  } from '../lib/form-rooyesh.js'

  let { docRow } = $props()

  const def = docRow.custom_fields.form_def
  // کپی عمیق با JSON (نه structuredClone — در jsdom نیست و پروب روی
  // آن می‌افتد؛ پاسخ‌ها فقط JSON ساده‌اند).
  let answers = $state(JSON.parse(JSON.stringify(docRow.custom_fields.form_answers || {})))
  let saveState = $state('saved') // saved | saving | error
  let saveTimer = null

  let completion = $derived(formCompletion(answers, def))
  let percentCheck = $derived(validateFormPercents(answers))

  function scheduleSave() {
    saveState = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      try {
        await setDocCustomFields(docRow, { form_answers: answers })
        saveState = 'saved'
      } catch (e) {
        saveState = 'error'
      }
    }, 600)
  }

  function setScalar(fieldId, value) {
    answers[fieldId] = value
    scheduleSave()
  }

  function setYesNo(fieldId, value) {
    const cur = answers[fieldId] || { value: null, detail: '' }
    answers[fieldId] = { value, detail: value === 'yes' ? cur.detail || '' : '' }
    scheduleSave()
  }

  function setYesNoDetail(fieldId, detail) {
    const cur = answers[fieldId] || { value: null, detail: '' }
    answers[fieldId] = { ...cur, detail }
    scheduleSave()
  }

  function setCell(fieldId, rowIdx, colId, value) {
    const rows = Array.isArray(answers[fieldId]) ? answers[fieldId] : []
    rows[rowIdx] = { ...(rows[rowIdx] || {}), [colId]: value }
    answers[fieldId] = rows
    scheduleSave()
  }

  function addTableRow(fieldId) {
    const rows = Array.isArray(answers[fieldId]) ? answers[fieldId] : []
    answers[fieldId] = [...rows, {}]
    scheduleSave()
  }

  function setStageCell(rowIdx, colId, value) {
    const cur = answers.stages || { rows: [{}], description: '' }
    const rows = Array.isArray(cur.rows) ? [...cur.rows] : [{}]
    rows[rowIdx] = { ...(rows[rowIdx] || {}), [colId]: value }
    answers.stages = { ...cur, rows }
    scheduleSave()
  }

  function addStageRow() {
    const cur = answers.stages || { rows: [{}], description: '' }
    const rows = Array.isArray(cur.rows) ? [...cur.rows, {}] : [{}]
    answers.stages = { ...cur, rows }
    scheduleSave()
  }

  function setStagesDescription(value) {
    const cur = answers.stages || { rows: [{}], description: '' }
    answers.stages = { ...cur, description: value }
    scheduleSave()
  }

  function printForm() {
    window.print()
  }
</script>

<div class="form-print mx-auto max-w-3xl p-4">
  <div class="no-print mb-4 flex flex-wrap items-center gap-2">
    <button class="btn-sclack" onclick={printForm}>🖨 چاپ کاربرگ</button>
    <span class="text-sm text-[var(--ink-soft)]">
      {#if saveState === 'saving'}
        در حال ذخیره…
      {:else if saveState === 'saved'}
        ذخیره شد ({faNum(completion.filled)} از {faNum(completion.total)} خانه — {faNum(completion.pct)}٪)
      {:else}
        ذخیره نشد — دوباره تلاش کنید.
      {/if}
    </span>
  </div>

  <div class="mb-4 rounded-xl border border-[var(--line)] bg-[var(--paper-soft)] p-3 text-sm">
    <p class="mb-2 font-bold">نکات راهنمای کاربرگ رسمی:</p>
    <ul class="list-disc pr-5">
      {#each FORM_GUIDE_NOTES as note}
        <li>{note}</li>
      {/each}
    </ul>
    <p class="mt-2 text-[var(--ink-soft)]">
      پر کردن اینجا آماده‌سازی است؛ ارسال رسمی کاربرگ با فایل و فرایند خود پارک انجام می‌شود.
      {#if FORM_SUBMIT_EMAIL}
        نشانی ارسال: {FORM_SUBMIT_EMAIL}
      {:else}
        نشانی ایمیل ارسال کاربرگ در سند طرح خالی است — باید از فراخوان فعال پارک یا استاد گرفته شود.
      {/if}
    </p>
  </div>

  {#if percentCheck.warnings.length > 0}
    <div class="alert alert-warning mb-4" role="alert">
      <ul class="list-disc pr-5 text-sm">
        {#each percentCheck.warnings as w}
          <li>{w}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#each def.sections as section}
    <section class="mb-6 rounded-xl border border-[var(--line)] bg-white p-4">
      <h2 class="mb-3 text-base font-bold text-[var(--jigari)]">{section.title}</h2>
      {#each section.fields as field}
        <div class="mb-4">
          <label class="mb-1 block text-sm font-bold" for={field.id}>{field.label}</label>
          {#if field.hint}
            <p class="mb-1 text-xs text-[var(--ink-soft)]">{field.hint}</p>
          {/if}

          {#if field.type === 'text'}
            <input
              id={field.id}
              class="input-sclack w-full"
              value={answers[field.id] || ''}
              oninput={(e) => setScalar(field.id, e.currentTarget.value)}
            />
          {:else if field.type === 'long-text'}
            <textarea
              id={field.id}
              class="input-sclack w-full"
              rows="3"
              value={answers[field.id] || ''}
              oninput={(e) => setScalar(field.id, e.currentTarget.value)}
            ></textarea>
          {:else if field.type === 'number'}
            <input
              id={field.id}
              type="number"
              class="input-sclack w-full"
              value={answers[field.id] ?? ''}
              oninput={(e) => setScalar(field.id, e.currentTarget.value)}
            />
          {:else if field.type === 'select'}
            <select
              id={field.id}
              class="input-sclack w-full"
              value={answers[field.id] || ''}
              onchange={(e) => setScalar(field.id, e.currentTarget.value)}
            >
              <option value="">— انتخاب کنید —</option>
              {#each field.options as opt}
                <option value={opt}>{opt}</option>
              {/each}
            </select>
          {:else if field.type === 'yes-no'}
            <div class="flex gap-2" role="group" aria-label={field.label}>
              <button
                class="btn {answers[field.id]?.value === 'yes' ? 'btn-sclack' : 'btn-outline'}"
                onclick={() => setYesNo(field.id, 'yes')}
              >
                بله
              </button>
              <button
                class="btn {answers[field.id]?.value === 'no' ? 'btn-sclack' : 'btn-outline'}"
                onclick={() => setYesNo(field.id, 'no')}
              >
                خیر
              </button>
            </div>
            {#if answers[field.id]?.value === 'yes'}
              <textarea
                class="input-sclack mt-2 w-full"
                rows="2"
                placeholder="در صورتی که پاسخ شما بله می‌باشد، پاسخ را شرح دهید:"
                value={answers[field.id]?.detail || ''}
                oninput={(e) => setYesNoDetail(field.id, e.currentTarget.value)}
              ></textarea>
            {/if}
          {:else if field.type === 'table'}
            <div class="overflow-x-auto">
              <table class="table w-full text-sm">
                <thead>
                  <tr>
                    {#each field.columns as col}
                      <th>{col.label}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each (Array.isArray(answers[field.id]) ? answers[field.id] : []) as row, ri}
                    <tr>
                      {#each field.columns as col}
                        <td>
                          {#if col.type === 'select'}
                            <select
                              class="input-sclack w-full"
                              value={row?.[col.id] || ''}
                              onchange={(e) => setCell(field.id, ri, col.id, e.currentTarget.value)}
                            >
                              <option value="">—</option>
                              {#each col.options as opt}
                                <option value={opt}>{opt}</option>
                              {/each}
                            </select>
                          {:else if col.type === 'number'}
                            <input
                              type="number"
                              class="input-sclack w-full"
                              value={row?.[col.id] ?? ''}
                              oninput={(e) => setCell(field.id, ri, col.id, e.currentTarget.value)}
                            />
                          {:else}
                            <input
                              class="input-sclack w-full"
                              value={row?.[col.id] || ''}
                              oninput={(e) => setCell(field.id, ri, col.id, e.currentTarget.value)}
                            />
                          {/if}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <button class="btn btn-sm btn-outline mt-2 no-print" onclick={() => addTableRow(field.id)}>
              + ردیف تازه
            </button>
          {:else if field.type === 'stages'}
            <div class="overflow-x-auto">
              <table class="table w-full text-sm">
                <thead>
                  <tr>
                    {#each field.columns as col}
                      <th>{col.label}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each (answers.stages?.rows || [{}]) as row, ri}
                    <tr>
                      {#each field.columns as col}
                        <td>
                          {#if col.type === 'number'}
                            <input
                              type="number"
                              class="input-sclack w-full"
                              value={row?.[col.id] ?? ''}
                              oninput={(e) => setStageCell(ri, col.id, e.currentTarget.value)}
                            />
                          {:else}
                            <input
                              class="input-sclack w-full"
                              value={row?.[col.id] || ''}
                              oninput={(e) => setStageCell(ri, col.id, e.currentTarget.value)}
                            />
                          {/if}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <button class="btn btn-sm btn-outline mt-2 no-print" onclick={addStageRow}>+ مرحلهٔ تازه</button>
            <label class="mt-3 mb-1 block text-sm font-bold" for="stages-desc">
              تشریح مراحل اجرای طرح (اجرای هر مرحله و نحوهٔ دستیابی به خروجی قابل درک در هر مرحله، به‌صورت جزئی و دقیق)
            </label>
            <textarea
              id="stages-desc"
              class="input-sclack w-full"
              rows="4"
              value={answers.stages?.description || ''}
              oninput={(e) => setStagesDescription(e.currentTarget.value)}
            ></textarea>
          {/if}
        </div>
      {/each}
    </section>
  {/each}

  <p class="text-xs text-[var(--ink-soft)]">
    {faNum(countRooyeshFields(def))} خانهٔ شمارش‌شدهٔ کاربرگ رسمی رویش.
  </p>
</div>
