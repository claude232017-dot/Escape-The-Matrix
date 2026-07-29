import { Motion } from '@/app/Motion';
import { AppShell } from '@/features/shell/components/AppShell';

export function App() {
  return (
    <Motion>
      <AppShell />
    </Motion>
  );
}
