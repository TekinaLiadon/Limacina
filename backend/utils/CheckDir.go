package utils

import (
	"fmt"
	"os"
)

func CheckDir() (string, error) {
	dirname, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("Ошибка при получении домашней директории: %w", err)
	}
	return dirname, nil
}
