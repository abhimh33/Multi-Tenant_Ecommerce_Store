import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Lightweight tooltip components (no Radix dependency).
 * Uses CSS hover-based tooltip positioning.
 */

const TooltipProvider = ({ children }) => <>{children}</>;
TooltipProvider.displayName = 'TooltipProvider';

const TooltipContext = React.createContext({ open: false, setOpen: () => {} });

function Tooltip({ children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-flex">{children}</div>
    </TooltipContext.Provider>
  );
}
Tooltip.displayName = 'Tooltip';

const TooltipTrigger = React.forwardRef(({ children, asChild, ...props }, ref) => {
  const { setOpen } = React.useContext(TooltipContext);
  return (
    <span
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      {...props}
    >
      {children}
    </span>
  );
});
TooltipTrigger.displayName = 'TooltipTrigger';

const SIDE_CLASSES = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const TooltipContent = React.forwardRef(
  ({ className, side = 'top', children, ...props }, ref) => {
    const { open } = React.useContext(TooltipContext);
    if (!open) return null;
    return (
      <div
        ref={ref}
        className={cn(
          'absolute z-50 rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95',
          SIDE_CLASSES[side] || SIDE_CLASSES.top,
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TooltipContent.displayName = 'TooltipContent';

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
