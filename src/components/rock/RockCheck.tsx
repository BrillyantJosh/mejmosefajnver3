import React from 'react';

interface RockCheckProps {
  size?: number;
  color?: string;
  className?: string;
  showText?: boolean;
  textSize?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl';
}

export const RockCheck: React.FC<RockCheckProps> = ({
  size = 32, 
  color = "currentColor", 
  className = "",
  showText = true,
  textSize = 'xs'
}) => {
  const textClasses = {
    'xs': 'text-xs',
    'sm': 'text-sm',
    'base': 'text-base',
    'lg': 'text-lg',
    'xl': 'text-xl',
    '2xl': 'text-2xl'
  };

  return (
    <div className={`flex flex-col items-center space-y-1 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 12 2 2 4-4" />
        <path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" />
        <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      </svg>
      {showText && (
        <span className={`text-green-600 font-medium ${textClasses[textSize]}`}>
          Rock
        </span>
      )}
    </div>
  );
};
