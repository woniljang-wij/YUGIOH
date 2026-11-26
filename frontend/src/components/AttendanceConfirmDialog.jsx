import React from 'react';

function AttendanceConfirmDialog({
  eyebrow,
  title,
  children,
  onCancel,
  onConfirm,
  cancelLabel = 'Hủy',
  confirmLabel = 'Xác nhận',
  confirmDisabled = false,
  pending = false,
  className = '',
  panelClassName = '',
  titleId = 'attendanceConfirmTitle'
}) {
  return (
    <div className={`attendance-dialog${className ? ` ${className}` : ''}`}>
      <button
        className="attendance-dialog__scrim"
        type="button"
        disabled={pending}
        onClick={onCancel}
        aria-label={cancelLabel}
      />
      <section
        className={`attendance-dialog__panel${panelClassName ? ` ${panelClassName}` : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <span className="attendance-dialog__eyebrow">{eyebrow}</span>
        <h3 id={titleId}>{title}</h3>
        {children}
        <div className="attendance-dialog__actions">
          <button
            className="attendance-button attendance-button--muted"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="attendance-button attendance-button--gold"
            type="button"
            disabled={confirmDisabled || pending}
            onClick={onConfirm}
          >
            {pending ? 'Đang xử lý…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export default AttendanceConfirmDialog;
