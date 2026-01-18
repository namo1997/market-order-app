export const Card = ({ children, className = '', onClick }) => {
  const clickableClass = onClick ? 'cursor-pointer hover:shadow-lg' : '';

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg shadow-md p-4 transition-shadow ${clickableClass} ${className}`}
    >
      {children}
    </div>
  );
};
