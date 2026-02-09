import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Home } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-muted/40 px-4">
      <h1 className="text-6xl font-bold text-primary">404</h1>
      <p className="text-xl text-muted-foreground mt-2">Page not found</p>
      <p className="text-sm text-muted-foreground mt-1">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button className="mt-6 gap-2" onClick={() => navigate('/dashboard')}>
        <Home className="h-4 w-4" />
        Go to Dashboard
      </Button>
    </div>
  );
}
