import React, { useState, useEffect, useRef } from 'react';
import { Copy, Scissors, Clipboard, Trash2, Pencil, Send, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ShiftContextMenu({ children, shift, onEdit, onCopy, onCut, onPaste, onDelete, onPublish, canPaste }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef(null);
  const isDraft = shift?.status === 'draft';

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPos({ x: e.clientX, y: e.clientY });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const closeKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeKey);
    };
  }, [open]);

  // Adjust position so menu doesn't go off screen
  useEffect(() => {
    if (open && menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      let { x, y } = pos;
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
      if (x !== pos.x || y !== pos.y) setPos({ x, y });
    }
  }, [open]);

  const item = (icon, label, onClick, danger = false, shortcut = '') => (
    <button
      key={label}
      className={cn(
        "flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left rounded hover:bg-accent transition-colors",
        danger && "text-destructive hover:bg-destructive/10"
      )}
      onMouseDown={(e) => { e.stopPropagation(); setOpen(false); onClick(); }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-muted-foreground">{shortcut}</span>}
    </button>
  );

  return (
    <>
      {React.cloneElement(children, { onContextMenu: handleContextMenu })}
      {open && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg py-1 w-48"
          style={{ left: pos.x, top: pos.y }}
        >
          {item(<Pencil className="w-3.5 h-3.5" />, 'Edit Shift', () => onEdit(shift))}
          <div className="my-1 border-t border-border" />
          {item(<Copy className="w-3.5 h-3.5" />, 'Copy', () => onCopy(shift), false, 'Ctrl+C')}
          {item(<Scissors className="w-3.5 h-3.5" />, 'Cut', () => onCut(shift), false, 'Ctrl+X')}
          {canPaste && item(<Clipboard className="w-3.5 h-3.5" />, 'Paste Here', () => onPaste({ date: new Date(shift.startDateTime), roleId: shift.roleId, teamMemberId: shift.teamMemberId }), false, 'Ctrl+V')}
          <div className="my-1 border-t border-border" />
          {isDraft
            ? item(<Send className="w-3.5 h-3.5" />, 'Publish Shift', () => onPublish(shift, false))
            : item(<EyeOff className="w-3.5 h-3.5" />, 'Revert to Draft', () => onPublish(shift, true))
          }
          <div className="my-1 border-t border-border" />
          {item(<Trash2 className="w-3.5 h-3.5" />, 'Delete', () => onDelete(shift.id), true, 'Del')}
        </div>
      )}
    </>
  );
}