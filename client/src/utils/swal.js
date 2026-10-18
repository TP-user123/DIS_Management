// Lightweight, premium SweetAlert implementation tailored for OpsDesk
// Returns standard Promise<{ isConfirmed: boolean, isDismissed: boolean, value?: string }>

const createIconSvg = (type) => {
  switch (type) {
    case 'warning':
      return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    case 'success':
      return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
    case 'error':
      return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    case 'question':
    case 'info':
    default:
      return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0077b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
};

export const Swal = {
  fire(options = {}) {
    return new Promise((resolve) => {
      const {
        title = '',
        text = '',
        html = '',
        icon = 'info', // warning, success, error, info, question
        input = null, // 'textarea' | 'text'
        inputLabel = '',
        inputPlaceholder = '',
        inputValue = '',
        inputValidator = null,
        showCancelButton = true,
        confirmButtonText = 'Confirm',
        cancelButtonText = 'Cancel',
        confirmButtonColor = '',
        focusConfirm = true
      } = options;

      // Container overlay
      const overlay = document.createElement('div');
      overlay.className = 'swal-custom-overlay';

      const iconHtml = icon ? `<div class="swal-icon-wrap swal-icon-${icon}">${createIconSvg(icon)}</div>` : '';
      const inputHtml = input === 'textarea'
        ? `<div class="swal-input-group">
            ${inputLabel ? `<label class="swal-input-label">${inputLabel}</label>` : ''}
            <textarea class="swal-textarea" placeholder="${inputPlaceholder}" rows="3">${inputValue}</textarea>
            <div class="swal-validation-error" style="display:none;"></div>
           </div>`
        : input === 'text'
        ? `<div class="swal-input-group">
            ${inputLabel ? `<label class="swal-input-label">${inputLabel}</label>` : ''}
            <input type="text" class="swal-input" placeholder="${inputPlaceholder}" value="${inputValue}" />
            <div class="swal-validation-error" style="display:none;"></div>
           </div>`
        : '';

      const buttonsHtml = `
        <div class="swal-actions">
          ${showCancelButton ? `<button type="button" class="swal-btn swal-btn-cancel">${cancelButtonText}</button>` : ''}
          <button type="button" class="swal-btn swal-btn-confirm" ${confirmButtonColor ? `style="background:${confirmButtonColor}"` : ''}>${confirmButtonText}</button>
        </div>
      `;

      overlay.innerHTML = `
        <div class="swal-custom-modal" role="dialog" aria-modal="true">
          ${iconHtml}
          ${title ? `<h3 class="swal-title">${title}</h3>` : ''}
          ${text ? `<p class="swal-text">${text}</p>` : ''}
          ${html ? `<div class="swal-html">${html}</div>` : ''}
          ${inputHtml}
          ${buttonsHtml}
        </div>
      `;

      document.body.appendChild(overlay);

      // Trigger animation
      requestAnimationFrame(() => {
        overlay.classList.add('swal-visible');
      });

      const confirmBtn = overlay.querySelector('.swal-btn-confirm');
      const cancelBtn = overlay.querySelector('.swal-btn-cancel');
      const inputEl = overlay.querySelector('.swal-textarea, .swal-input');
      const errorEl = overlay.querySelector('.swal-validation-error');

      if (inputEl) {
        inputEl.focus();
        if (inputValue) {
          inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        }
      } else if (confirmBtn && focusConfirm) {
        confirmBtn.focus();
      }

      const closeWith = (result) => {
        overlay.classList.remove('swal-visible');
        overlay.classList.add('swal-hiding');
        setTimeout(() => {
          overlay.remove();
          resolve(result);
        }, 200);
      };

      const handleConfirm = async () => {
        let val = inputEl ? inputEl.value : true;
        if (inputValidator) {
          const validationMsg = await inputValidator(val);
          if (validationMsg) {
            if (errorEl) {
              errorEl.innerText = validationMsg;
              errorEl.style.display = 'block';
              if (inputEl) inputEl.classList.add('swal-input-invalid');
            }
            return;
          }
        }
        closeWith({ isConfirmed: true, isDismissed: false, value: val });
      };

      if (confirmBtn) {
        confirmBtn.addEventListener('click', handleConfirm);
      }

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          closeWith({ isConfirmed: false, isDismissed: true });
        });
      }

      // Keyboard handling
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          closeWith({ isConfirmed: false, isDismissed: true });
          document.removeEventListener('keydown', handleKeyDown);
        } else if (e.key === 'Enter') {
          if (input === 'textarea') {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              handleConfirm();
            }
          } else {
            e.preventDefault();
            handleConfirm();
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      // Dismiss on clicking backdrop outside modal
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeWith({ isConfirmed: false, isDismissed: true });
          document.removeEventListener('keydown', handleKeyDown);
        }
      });
    });
  },

  // Shorthand confirmation dialog
  confirm(title, text = '', confirmButtonText = 'Yes, Confirm') {
    return this.fire({
      title,
      text,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText,
      cancelButtonText: 'Cancel'
    });
  },

  // Shorthand prompt with textarea (for descriptions / remarks)
  prompt(title, inputLabel = 'Description / Notes', placeholder = 'Enter details here...', required = false) {
    return this.fire({
      title,
      icon: 'question',
      input: 'textarea',
      inputLabel,
      inputPlaceholder: placeholder,
      showCancelButton: true,
      confirmButtonText: 'Submit',
      cancelButtonText: 'Cancel',
      inputValidator: required ? (val) => (!val?.trim() ? 'Description is required' : null) : null
    });
  },

  success(title, text = '') {
    return this.fire({
      title,
      text,
      icon: 'success',
      showCancelButton: false,
      confirmButtonText: 'OK'
    });
  },

  error(title, text = '') {
    return this.fire({
      title,
      text,
      icon: 'error',
      showCancelButton: false,
      confirmButtonText: 'OK'
    });
  }
};

export default Swal;
