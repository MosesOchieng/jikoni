import { useEffect } from 'react';

function App() {
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `${import.meta.env.BASE_URL}main.js`;
    script.dataset.mamaMbogaApp = 'true';
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return <div id="app" />;
}

export default App;
