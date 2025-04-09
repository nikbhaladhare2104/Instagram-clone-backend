const handleError = (res, error, customMessage = "Internal server error") => {
  console.error('Error:', error?.response?.data || error.message);
  return res.status(500).json({
    success: false,
    message: customMessage,
    error: error.message || error,
  });
};

module.exports = { handleError };
