import { Header } from './Header';
import { Navigation } from './Navigation';

export const Layout = ({ children, mainClassName = '' }) => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <Navigation />
      <main className={`container mx-auto px-4 py-6 pb-20 flex-1 ${mainClassName}`}>
        {children}
      </main>
    </div>
  );
};
