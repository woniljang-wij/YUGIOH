(function () {
  'use strict';

  const registerForm = document.getElementById('registerForm');
  const loginForm = document.getElementById('loginForm');
  const message = document.getElementById('authMessage');
  const title = document.getElementById('authTitle');
  const description = document.getElementById('authDescription');
  const tabs = document.querySelectorAll('[data-auth-view]');
  const authenticatedTabKey = 'yugioh.authenticatedTab';

  function showMessage(text, success) {
    message.textContent = text;
    message.classList.toggle('is-success', Boolean(success));
  }

  function selectView(view) {
    const isRegister = view === 'register';
    registerForm.hidden = !isRegister;
    loginForm.hidden = isRegister;
    title.textContent = isRegister ? 'Tạo tài khoản' : 'Chào mừng trở lại';
    description.textContent = isRegister
      ? 'Đăng ký trước, sau đó đăng nhập để vào game.'
      : 'Đăng nhập bằng tên tài khoản và mật khẩu của bạn.';
    tabs.forEach(function (tab) {
      const selected = tab.dataset.authView === view;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    showMessage('', false);
  }

  async function sendForm(form, endpoint, payload) {
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    showMessage('Đang xử lý…', false);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        showMessage(result.error || 'Không thể xử lý yêu cầu.', false);
        return null;
      }
      return result;
    } catch (error) {
      showMessage('Không kết nối được máy chủ. Hãy kiểm tra Flask đang chạy.', false);
      return null;
    } finally {
      submitButton.disabled = false;
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      selectView(tab.dataset.authView);
    });
  });

  document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      const input = button.parentElement.querySelector('input');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    });
  });

  registerForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;

    const values = new FormData(registerForm);
    const result = await sendForm(registerForm, '/api/register', {
      username: values.get('username'),
      email: values.get('email'),
      password: values.get('password'),
      confirmation: values.get('confirmation')
    });
    if (!result) return;

    loginForm.elements.username.value = values.get('username');
    loginForm.elements.password.value = '';
    selectView('login');
    showMessage(result.message, true);
    loginForm.elements.password.focus();
  });

  loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;

    const values = new FormData(loginForm);
    const result = await sendForm(loginForm, '/api/login', {
      username: values.get('username'),
      password: values.get('password')
    });
    if (!result) return;

    try {
      window.sessionStorage.setItem(authenticatedTabKey, 'true');
    } catch (error) {
      console.error('Could not save the authenticated tab state:', error);
      showMessage('Không thể lưu phiên đăng nhập trong tab này. Hãy bật bộ nhớ trình duyệt và thử lại.', false);
      return;
    }
    window.location.replace('/start');
  });

  selectView('login');
})();
