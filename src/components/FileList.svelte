<script>
  import { auth, ws } from '../lib/store.svelte.js'
  import { memberName } from '../lib/data.js'
  import {
    listFiles,
    uploadFile,
    downloadFile,
    deleteFile,
    formatFileSize,
    MAX_FILE_SIZE
  } from '../lib/docs.js'

  // props: projectId (required), attachedTo {type:'room'|'doc', id} or null.
  // When attachedTo is set, the upload attaches the file to that room/doc;
  // the list still shows the whole project's files.
  let { projectId, attachedTo = null } = $props()

  let fileInput = $state(null)
  let uploadMsg = $state('')
  let uploadMsgKind = $state('')
  let uploading = $state(false)
  let busyId = $state(null)
  // In-app two-step delete confirmation (D6 bug 3): the native confirm()
  // dialog is not reliably answered in automation / on mobile, so the
  // first tap arms the button and the second tap deletes.
  let armDeleteId = $state(null)

  const files = $derived(ws.files.filter((f) => f.project_id === projectId))
  // RLS allows delete only for the uploader (w1 files delete own).
  const canDelete = (f) => auth.member && f.uploaded_by === auth.member.id

  async function doUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    uploading = true
    uploadMsg = 'در حال فرستادن…'
    uploadMsgKind = ''
    try {
      await uploadFile(projectId, file, attachedTo)
      uploadMsg = 'فایل فرستاده شد.'
      uploadMsgKind = 'ok'
    } catch (e) {
      uploadMsg = e.message || String(e)
      uploadMsgKind = 'error'
    } finally {
      uploading = false
      if (fileInput) fileInput.value = ''
    }
  }

  async function doDownload(f) {
    busyId = f.id
    try {
      const url = await downloadFile(f)
      const a = document.createElement('a')
      a.href = url
      a.download = f.name
      a.target = '_blank'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      uploadMsg = e.message || String(e)
      uploadMsgKind = 'error'
    } finally {
      busyId = null
    }
  }

  async function doDelete(f) {
    if (armDeleteId !== f.id) {
      armDeleteId = f.id
      return
    }
    armDeleteId = null
    busyId = f.id
    try {
      await deleteFile(f)
      uploadMsg = 'فایل «' + f.name + '» حذف شد.'
      uploadMsgKind = 'ok'
    } catch (e) {
      uploadMsg = e.message || String(e)
      uploadMsgKind = 'error'
    } finally {
      busyId = null
    }
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleDateString('fa-IR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return ''
    }
  }

  $effect(() => {
    if (projectId) listFiles(projectId)
  })
</script>

<section>
  <h3 class="mb-2 text-sm font-bold opacity-70">
    فایل‌ها {attachedTo
      ? attachedTo.type === 'doc'
        ? '(پیوست به این سند)'
        : '(پیوست به این اتاق)'
      : ''}
  </h3>
  <div class="flex flex-wrap items-center gap-2">
    <label class="btn btn-sclack btn-outline btn-sm">
      انتخاب فایل (حداکثر ۵ مگابایت)
      <input
        type="file"
        class="hidden"
        bind:this={fileInput}
        onchange={doUpload}
        disabled={uploading}
      />
    </label>
    {#if uploading}
      <span class="text-xs opacity-70">در حال فرستادن…</span>
    {/if}
  </div>
  {#if uploadMsg}
    <p
      class="mt-2 text-xs {uploadMsgKind === 'error'
        ? 'text-error'
        : uploadMsgKind === 'ok'
          ? 'text-success'
          : 'opacity-70'}"
    >
      {uploadMsg}
    </p>
  {/if}

  {#if files.length === 0}
    <p class="mt-3 text-sm opacity-50">هنوز فایلی نیست.</p>
  {:else}
    <ul class="mt-3 flex flex-col gap-1">
      {#each files as f (f.id)}
        <li
          class="flex flex-wrap items-center gap-2 rounded-xl bg-base-100 px-3 py-2 text-sm shadow-sm"
        >
          <span class="min-w-0 flex-1 break-words font-medium">{f.name}</span>
          <span class="text-xs opacity-60">{formatFileSize(f.size)}</span>
          <span class="text-xs opacity-60">{memberName(f.uploaded_by)}</span>
          <span class="text-xs opacity-60">{fmtTime(f.uploaded_at)}</span>
          {#if f.attached_to_type}
            <span class="rounded-full bg-base-200 px-2 py-0.5 text-xs opacity-70">
              {f.attached_to_type === 'doc' ? 'سند' : 'اتاق'}
            </span>
          {/if}
          <button
            class="btn btn-ghost btn-xs"
            onclick={() => doDownload(f)}
            disabled={busyId === f.id}
          >
            دانلود
          </button>
          {#if canDelete(f)}
            <button
              class="btn btn-ghost btn-xs {armDeleteId === f.id ? 'btn-error' : 'text-error'}"
              onclick={() => doDelete(f)}
              disabled={busyId === f.id}
            >
              {armDeleteId === f.id ? 'مطمئنید؟' : 'حذف'}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="mt-2 text-xs opacity-50">
    سقف هر فایل ۵ مگابایت است. دانلود با لینک یک‌ساعته انجام می‌شود.
  </p>
</section>
