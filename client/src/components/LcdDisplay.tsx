import React from 'react';

interface LcdDisplayProps {
  value: string;
  suffix?: string;
  size?: number;
}

const VALID_DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', ' ']);

export const LcdDisplay: React.FC<LcdDisplayProps> = ({ value, suffix, size = 44 }) => {
  const chars = Array.from(value);

  return (
    <div className="lcd-readout" aria-label={`${value}${suffix || ''}`}>
      {chars.map((ch, idx) => {
        if (ch === '.') {
          return <span key={idx} className="lcd-dot" style={{ fontSize: size }} aria-hidden="true" />;
        }
        const digitAttr = VALID_DIGITS.has(ch) ? ch : ' ';
        return (
          <div
            key={idx}
            className="lcd-digit"
            data-digit={digitAttr}
            style={{ fontSize: size }}
            aria-hidden="true"
          >
            <i className="a" />
            <i className="b" />
            <i className="c" />
            <i className="d" />
            <i className="e" />
            <i className="f" />
            <i className="g" />
          </div>
        );
      })}
      {suffix && (
        <span className="lcd-suffix" aria-hidden="true">
          {suffix}
        </span>
      )}
    </div>
  );
};
