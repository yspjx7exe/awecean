import { api, errorMessage } from '../api.js';
import { session, applyMe } from '../state.js';
import { compressImage, html } from '../utils.js';
import { icon } from '../icons.js';
import {
  emptyState,
  layout,
  pageHead,
  toast,
} from '../ui.js';

async function uploadImage(file, { maxSize = 1600, quality = 0.87 } = {}) {
  const dataUrl = await compressImage(file, { maxSize, quality });
  const result = await api.upload(dataUrl);
  return { url: result.url, preview: dataUrl };
}

export async function createView({ params }) {
  const me = session.me;
  const editing = Boolean(params.id);
  let object = null;
  if (editing) {
    object = await api.get(`/api/objects/${encodeURIComponent(params.id)}`);
    if (!object.canEdit) {
      return {
        title: '无权编辑 · Awecean',
        active: 'explore',
        html: layout(
          html`<div style="padding-top:40px">
            ${emptyState({
              title: '这个敬畏对象暂时不能修改',
              description: '它被设为私有，只有创建者可以编辑。',
              action: html`<a class="btn btn--primary" href="/o/${object.id}">回到对象</a>`,
              iconName: 'lock',
            })}
          </div>`,
          { me, active: 'explore' }
        ),
      };
    }
  }

  const state = {
    mainImage: object?.mainImage || null,
    gallery: [...(object?.gallery || [])],
    textOnly: !object?.mainImage && editing,
    uploading: 0,
    busy: false,
  };
  const content = html`<div class="create-page">
    <a class="object-detail__back" href="${editing ? `/o/${object.id}` : '/explore'}">${icon('arrow-left', { size: 14 })} ${editing ? '回到对象' : '回到探索'}</a>
    ${pageHead({
      title: editing ? '编辑对象' : '创建对象',
      description: editing ? '' : '名称和名言必填，图片可选。',
      center: true,
    })}

    <form class="create-layout" data-object-form novalidate>
      <div class="create-visual">
        <div class="upload-zone" data-upload-zone tabindex="0" role="button" aria-label="上传主图">
          <input type="file" accept="image/jpeg,image/png,image/webp" data-main-input />
          ${state.mainImage
            ? html`<img data-main-preview src="${state.mainImage}" alt="主图预览" />
                <button class="upload-zone__remove" type="button" data-main-remove aria-label="移除主图">${icon('x', { size: 15 })}</button>
                <span class="upload-zone__overlay">点击更换主图</span>`
            : html`<span class="upload-zone__icon">${icon('camera', { size: 22 })}</span>
                <strong data-upload-title>${state.textOnly ? '纯文字呈现' : '上传主图'}</strong>
                <small>支持常见图片格式，自动压缩</small>`}
          <span class="upload-zone__busy" hidden>${icon('loader', { size: 20 })}<span>正在上传</span></span>
        </div>
        <div class="gallery-editor" data-gallery-editor>
          ${state.gallery.map(
            (image, index) => html`<div class="gallery-editor__item" data-gallery-item="${index}">
              <img src="${image}" alt="次要图 ${index + 1}" />
              <button type="button" data-gallery-remove="${index}" aria-label="移除">${icon('x', { size: 11 })}</button>
            </div>`
          )}
          <button class="gallery-editor__add" type="button" data-gallery-add aria-label="添加次要图片">${icon('plus', { size: 20 })}</button>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-gallery-input />
        </div>
        <p class="field-help" style="margin-top:9px">最多 5 张，点击缩略图放大。</p>
      </div>

      <div>
        <div class="form-section">
          <div class="form-section__title">基本信息</div>
          <div class="form-stack">
            <div class="field">
              <label for="object-name">名称 <span>必填 · 40 字以内</span></label>
              <input id="object-name" name="name" value="${object?.name || ''}" placeholder="一个人名，或一个象征的名字" maxlength="40" required data-preview-name-input />
            </div>
            <div class="field">
              <label for="object-quote">名言名句 <span>必填 · 160 字以内</span></label>
              <textarea id="object-quote" name="quote" placeholder="一句该对象的名言，或一句有道理的诗句、句子" maxlength="160" required data-preview-quote-input>${object?.quote || ''}</textarea>
            </div>
            <div class="field">
              <label for="object-source">出处 <span>可选</span></label>
              <input id="object-source" name="quoteSource" value="${object?.quoteSource || ''}" placeholder="作者、书名或篇名" maxlength="80" />
            </div>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section__title">介绍</div>
          <div class="field">
            <label for="object-intro">简介 <span>可选 · 1200 字以内</span></label>
            <textarea id="object-intro" name="intro" style="min-height:150px" placeholder="写下你为何敬畏它。可以是一个故事、一段记忆，或一种解释。" maxlength="1200">${object?.intro || ''}</textarea>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section__title">图片</div>
          <label class="checkbox-line">
            <input type="checkbox" name="textOnly" ${state.textOnly ? 'checked' : ''} data-text-only />
            <span>不上传主图，使用纯文字呈现（名言仍为必填）</span>
          </label>
          <p class="field-help" style="margin-top:7px">主图与次要图片都可以之后再补充。上传时会温和压缩，保留清晰度。</p>
        </div>

        <div class="form-section">
          <div class="form-section__title">编辑权限</div>
          <div class="visibility-options" data-visibility-options>
            <label class="visibility-option ${object?.visibility !== 'private' ? 'is-selected' : ''}" data-visibility-option="public">
              <input type="radio" name="visibility" value="public" ${object?.visibility !== 'private' ? 'checked' : ''} ${editing && !object.isOwner ? 'disabled' : ''} />
              <span class="visibility-option__icon">${icon('lock-open', { size: 18 })}</span>
              <span><strong>公开</strong><small>任何成员都可以修改主图、次要图、简介与名言。</small></span>
            </label>
            <label class="visibility-option ${object?.visibility === 'private' ? 'is-selected' : ''}" data-visibility-option="private">
              <input type="radio" name="visibility" value="private" ${object?.visibility === 'private' ? 'checked' : ''} ${editing && !object.isOwner ? 'disabled' : ''} />
              <span class="visibility-option__icon">${icon('lock', { size: 18 })}</span>
              <span><strong>私有</strong><small>只有创建者可以修改。公开之后，也只有创建者能把它收回私有。</small></span>
            </label>
          </div>
          ${editing && !object.isOwner
            ? html`<p class="field-help" style="margin-top:8px">这是公开对象，你可以修改内容；但只有创建者可以更改编辑权限。</p>`
            : html`<p class="field-help" style="margin-top:8px">创建后，只有你可以把公开对象改为私有。</p>`}
        </div>

        <div class="form-actions" style="justify-content:space-between">
          <a class="btn btn--ghost" href="${editing ? `/o/${object.id}` : '/explore'}">取消</a>
          <button class="btn btn--primary" type="submit" data-submit>${editing ? '保存修改' : '创建敬畏对象'} ${icon('arrow-right', { size: 15 })}</button>
        </div>
      </div>
    </form>
  </div>`;

  return {
    title: editing ? '编辑 · Awecean' : '创建 · Awecean',
    active: editing ? 'object' : 'create',
    html: layout(content, { me, active: editing ? 'explore' : 'create' }),
    mount(root) {
      const form = root.querySelector('[data-object-form]');
      const zone = root.querySelector('[data-upload-zone]');
      const mainInput = root.querySelector('[data-main-input]');
      const galleryInput = root.querySelector('[data-gallery-input]');
      const galleryEditor = root.querySelector('[data-gallery-editor]');
      const textOnly = root.querySelector('[data-text-only]');
      const submit = root.querySelector('[data-submit]');
      const busy = root.querySelector('.upload-zone__busy');

      const renderMain = () => {
        const img = zone.querySelector('[data-main-preview]');
        const remove = zone.querySelector('[data-main-remove]');
        const iconEl = zone.querySelector('.upload-zone__icon');
        const title = zone.querySelector('[data-upload-title]');
        const small = zone.querySelector('small');
        const overlay = zone.querySelector('.upload-zone__overlay');
        if (state.textOnly) {
          img?.remove();
          remove?.remove();
          overlay?.remove();
          if (!iconEl) {
            zone.insertAdjacentHTML('afterbegin', `<span class="upload-zone__icon">${icon('feather', { size: 22 }).value}</span>`);
          }
          const titleEl = zone.querySelector('[data-upload-title]');
          if (titleEl) titleEl.textContent = '纯文字呈现';
          else if (!zone.querySelector('strong')) zone.insertAdjacentHTML('beforeend', '<strong data-upload-title>纯文字呈现</strong>');
          const sm = zone.querySelector('small');
          if (sm) sm.textContent = '不需要图片 · 以名称与名言呈现';
          zone.classList.add('is-text-mode');
          return;
        }
        zone.classList.remove('is-text-mode');
        const titleEl = zone.querySelector('[data-upload-title]');
        if (titleEl) titleEl.textContent = '上传主图';
        if (small) small.textContent = '支持常见图片格式，自动压缩';
        if (state.mainImage) {
          if (!zone.querySelector('[data-main-preview]')) {
            zone.insertAdjacentHTML('beforeend', `<img data-main-preview src="${state.mainImage}" alt="主图预览" />`);
            zone.insertAdjacentHTML('beforeend', `<span class="upload-zone__overlay">点击更换主图</span>`);
            zone.insertAdjacentHTML('beforeend', `<button class="upload-zone__remove" type="button" data-main-remove aria-label="移除主图">${icon('x', { size: 15 }).value}</button>`);
          }
          zone.querySelector('[data-main-preview]').src = state.mainImage;
          if (zone.querySelector('.upload-zone__icon')) zone.querySelector('.upload-zone__icon').remove();
          const title2 = zone.querySelector('[data-upload-title]');
          if (title2) title2.remove();
        } else {
          zone.querySelector('[data-main-preview]')?.remove();
          zone.querySelector('.upload-zone__remove')?.remove();
          zone.querySelector('.upload-zone__overlay')?.remove();
          if (!zone.querySelector('.upload-zone__icon')) {
            zone.insertAdjacentHTML('afterbegin', `<span class="upload-zone__icon">${icon('camera', { size: 22 }).value}</span>`);
          }
          if (!zone.querySelector('[data-upload-title]')) {
            zone.insertAdjacentHTML('beforeend', '<strong data-upload-title>上传一张主图</strong>');
          }
          const small2 = zone.querySelector('small');
          if (small2) small2.textContent = '支持常见图片格式，自动压缩';
        }
      };

      const renderGallery = () => {
        galleryEditor.querySelectorAll('[data-gallery-item]').forEach((node) => node.remove());
        const addButton = galleryEditor.querySelector('[data-gallery-add]');
        state.gallery.forEach((image, index) => {
          const node = document.createElement('div');
          node.className = 'gallery-editor__item';
          node.dataset.galleryItem = String(index);
          node.innerHTML = `<img src="${image}" alt="次要图 ${index + 1}" /><button type="button" data-gallery-remove="${index}" aria-label="移除">${icon('x', { size: 11 }).value}</button>`;
          galleryEditor.insertBefore(node, addButton);
        });
        addButton.style.display = state.gallery.length >= 5 ? 'none' : '';
      };

      const setBusy = (count) => {
        state.uploading += count;
        busy.hidden = state.uploading <= 0;
      };

      const handleMainFile = async (file) => {
        if (!file) return;
        setBusy(1);
        try {
          const result = await uploadImage(file);
          state.mainImage = result.url;
          renderMain();
          toast('主图已上传', 'success');
        } catch (error) {
          toast(errorMessage(error), 'error');
        } finally {
          setBusy(-1);
        }
      };

      const handleGalleryFiles = async (files) => {
        const room = 5 - state.gallery.length;
        const chosen = Array.from(files).slice(0, room);
        if (!chosen.length) {
          toast('次要图片最多 5 张', 'info');
          return;
        }
        setBusy(chosen.length);
        for (const file of chosen) {
          try {
            const result = await uploadImage(file, { maxSize: 1400, quality: 0.85 });
            state.gallery.push(result.url);
            renderGallery();
          } catch (error) {
            toast(errorMessage(error), 'error');
          } finally {
            setBusy(-1);
          }
        }
      };

      zone.addEventListener('click', (event) => {
        if (state.textOnly) return;
        if (event.target.closest('[data-main-remove]')) {
          state.mainImage = null;
          renderMain();
          return;
        }
        mainInput.click();
      });
      zone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!state.textOnly) mainInput.click();
        }
      });
      mainInput.addEventListener('change', () => {
        handleMainFile(mainInput.files?.[0]);
        mainInput.value = '';
      });
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('is-dragging');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('is-dragging');
        if (!state.textOnly) handleMainFile(event.dataTransfer.files?.[0]);
      });

      root.querySelector('[data-gallery-add]').addEventListener('click', () => galleryInput.click());
      galleryInput.addEventListener('change', () => {
        handleGalleryFiles(galleryInput.files);
        galleryInput.value = '';
      });
      galleryEditor.addEventListener('click', (event) => {
        const remove = event.target.closest('[data-gallery-remove]');
        if (!remove) return;
        state.gallery.splice(Number(remove.dataset.galleryRemove), 1);
        renderGallery();
      });

      textOnly.addEventListener('change', () => {
        state.textOnly = textOnly.checked;
        if (state.textOnly) state.mainImage = null;
        renderMain();
      });

      root.querySelectorAll('[data-visibility-option]').forEach((option) => {
        option.addEventListener('click', () => {
          const input = option.querySelector('input');
          if (input.disabled) return;
          root.querySelectorAll('[data-visibility-option]').forEach((item) => item.classList.remove('is-selected'));
          option.classList.add('is-selected');
          input.checked = true;
        });
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (state.busy) {
          toast('图片还在上传中，请稍候', 'info');
          return;
        }
        if (state.uploading > 0) {
          toast('图片还在上传中，请稍候', 'info');
          return;
        }
        const data = Object.fromEntries(new FormData(form).entries());
        if (!data.name?.trim()) {
          toast('请填写敬畏对象的名称', 'error');
          form.querySelector('[name=name]').focus();
          return;
        }
        if (!data.quote?.trim()) {
          toast('名言名句是必填的', 'error');
          form.querySelector('[name=quote]').focus();
          return;
        }
        const visibility = form.querySelector('[name=visibility]:checked')?.value || 'public';
        const payload = {
          name: data.name.trim(),
          quote: data.quote.trim(),
          quoteSource: data.quoteSource?.trim() || '',
          intro: data.intro?.trim() || '',
          mainImage: state.textOnly ? null : state.mainImage,
          gallery: state.gallery,
          visibility,
        };
        submit.classList.add('is-loading');
        submit.disabled = true;
        try {
          if (editing) {
            const updated = await api.patch(`/api/objects/${object.id}`, payload);
            toast('修改已保存', 'success');
            window.history.pushState({}, '', `/o/${updated.id}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
          } else {
            const created = await api.post('/api/objects', payload);
            toast(`「${created.name}」已被创建`, 'success');
            window.history.pushState({}, '', `/o/${created.id}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        } catch (error) {
          toast(errorMessage(error), 'error');
          submit.classList.remove('is-loading');
          submit.disabled = false;
        }
      });

      renderMain();
      renderGallery();
    },
  };
}
