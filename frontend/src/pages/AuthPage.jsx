import { useEffect, useRef, useState } from 'react';
import { useButtonSound } from '../useButtonSound.js';

const authenticatedTabKey = 'yugioh.authenticatedTab';

function PasswordField({ name, label, autoComplete, minLength, maxLength, inputRef }) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? `Ẩn ${label.toLowerCase()}` : `Hiện ${label.toLowerCase()}`;

  return (
    <label className="auth-field">
      <span>{label}</span>
      <span className="auth-field__password">
        <input
          ref={inputRef}
          name={name}
          type={visible ? 'text' : 'password'}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          required
        />
        <button
          className="auth-eye"
          type="button"
          aria-label={toggleLabel}
          aria-pressed={visible}
          data-password-toggle
          onClick={() => setVisible((current) => !current)}
        >
          ◉
        </button>
      </span>
    </label>
  );
}

function AuthPage() {
  const [view, setView] = useState('login');
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [username, setUsername] = useState('');
  const loginPasswordRef = useRef(null);
  const playButtonSound = useButtonSound();

  useEffect(() => {
    document.body.className = 'auth-page';
    document.title = 'Đăng nhập · Yu-Gi-Oh!';
  }, []);

  function selectView(nextView) {
    setView(nextView);
    setMessage('');
    setIsSuccess(false);
  }

  async function sendForm(endpoint, payload) {
    setIsSubmitting(true);
    setMessage('Đang xử lý…');
    setIsSuccess(false);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || 'Không thể xử lý yêu cầu.');
        return null;
      }
      return result;
    } catch {
      setMessage('Không kết nối được máy chủ. Hãy kiểm tra Flask đang chạy.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const registeredUsername = String(values.get('username'));
    const result = await sendForm('/api/register', {
      username: registeredUsername,
      email: values.get('email'),
      password: values.get('password'),
      confirmation: values.get('confirmation')
    });
    if (!result) return;

    setUsername(registeredUsername);
    selectView('login');
    setMessage(result.message);
    setIsSuccess(true);
    requestAnimationFrame(() => loginPasswordRef.current?.focus());
  }

  async function handleLogin(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const result = await sendForm('/api/login', {
      username: values.get('username'),
      password: values.get('password')
    });
    if (!result) return;

    try {
      window.sessionStorage.setItem(authenticatedTabKey, 'true');
    } catch (error) {
      console.error('Could not save the authenticated tab state:', error);
      setMessage('Không thể lưu phiên đăng nhập trong tab này. Hãy bật bộ nhớ trình duyệt và thử lại.');
      setIsSuccess(false);
      return;
    }
    window.location.replace('/start');
  }

  const isRegister = view === 'register';

  return (
    <main className="auth-layout" onClickCapture={playButtonSound}>
      <section className="auth-intro" aria-label="Yu-Gi-Oh!">
        <span className="auth-intro__eyebrow">DUELIST PORTAL</span>
        <h1>Yu-Gi-Oh!</h1>
        <p>Đăng nhập để bước vào thế giới đấu bài.</p>
        <div className="auth-intro__sigil" aria-hidden="true">遊☆戯☆王</div>
      </section>

      <section className="auth-panel" aria-labelledby="authTitle">
        <div className="auth-panel__heading">
          <span className="auth-panel__mark" aria-hidden="true">✦</span>
          <h2 id="authTitle">{isRegister ? 'Tạo tài khoản' : 'Chào mừng trở lại'}</h2>
          <p id="authDescription">
            {isRegister
              ? 'Đăng ký trước, sau đó đăng nhập để vào game.'
              : 'Đăng nhập bằng tên tài khoản và mật khẩu của bạn.'}
          </p>
        </div>

        <div className="auth-switch" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
          <button
            className={`auth-switch__button${!isRegister ? ' is-active' : ''}`}
            id="loginTab"
            type="button"
            role="tab"
            aria-controls="loginForm"
            aria-selected={!isRegister}
            data-auth-view="login"
            onClick={() => selectView('login')}
          >
            Đăng nhập
          </button>
          <button
            className={`auth-switch__button${isRegister ? ' is-active' : ''}`}
            id="registerTab"
            type="button"
            role="tab"
            aria-controls="registerForm"
            aria-selected={isRegister}
            data-auth-view="register"
            onClick={() => selectView('register')}
          >
            Đăng ký
          </button>
        </div>

        <form
          className="auth-form"
          id="registerForm"
          autoComplete="on"
          onSubmit={handleRegister}
          hidden={!isRegister}
        >
            <label className="auth-field">
              <span>Tên tài khoản</span>
              <input
                name="username"
                type="text"
                minLength={3}
                maxLength={24}
                pattern="[A-Za-z0-9_.\-]{3,24}"
                autoComplete="username"
                required
              />
              <small>Tên này sẽ được dùng trong game.</small>
            </label>
            <label className="auth-field">
              <span>Email</span>
              <input name="email" type="email" maxLength={254} autoComplete="email" required />
            </label>
            <PasswordField name="password" label="Mật khẩu" autoComplete="new-password" minLength={8} maxLength={128} />
            <PasswordField name="confirmation" label="Xác nhận mật khẩu" autoComplete="new-password" minLength={8} maxLength={128} />
            <button className="auth-submit" type="submit" disabled={isSubmitting}>Đăng ký tài khoản</button>
        </form>
        <form
          className="auth-form"
          id="loginForm"
          autoComplete="on"
          onSubmit={handleLogin}
          hidden={isRegister}
        >
            <label className="auth-field">
              <span>Tên tài khoản</span>
              <input
                name="username"
                type="text"
                minLength={3}
                maxLength={24}
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <PasswordField
              inputRef={loginPasswordRef}
              name="password"
              label="Mật khẩu"
              autoComplete="current-password"
              maxLength={128}
            />
            <button className="auth-submit" type="submit" disabled={isSubmitting}>Đăng nhập</button>
        </form>

        <p className={`auth-message${isSuccess ? ' is-success' : ''}`} id="authMessage" role="status" aria-live="polite">
          {message}
        </p>
        <p className="auth-panel__foot">Cùng nhau chiến thôi.</p>
      </section>
    </main>
  );
}

export default AuthPage;
