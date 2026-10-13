import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Legacy OTP Screen — retired in favor of password-based authentication.
 * Automatically redirects any residual navigation back to the primary sign-in screen.
 */
export const OtpScreen: React.FC<any> = () => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  return null;
};

export default OtpScreen;
