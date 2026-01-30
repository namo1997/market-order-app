export const Card = ({ children, className = '', onClick, ...props }) => {
  const clickableClass = onClick ? 'cursor-pointer hover:shadow-lg' : '';

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg shadow-md p-4 transition-shadow touch-pan-y ${clickableClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
