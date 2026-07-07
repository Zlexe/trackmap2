import React from 'react';

const LS = () => {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <iframe
        src="https://zhd-streamlit.onrender.com"
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Журнал ШЧ"
        allow="fullscreen"
      />
    </div>
  );
};

export default LS;