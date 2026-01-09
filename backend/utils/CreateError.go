package utils

import (
	"fmt"
	"log"
)

// 1000 - 1999 Связанное с os 2000 - 2999 с сетью и джсонами
var errorMessages = map[int]string{
	1000: "Ошибка при получении домашней директории",
	1001: "Нет прав на создание каталога",
	1002: "Не вышло получить информацию об папке",
	1003: "Не удалось удалить директорию",
}

func createMessage(code int) string {
	if msg, exists := errorMessages[code]; exists {
		return msg
	}
	return "Неизвестная ошибка"
}

func CreateError(code int, originalErr error) error {
	message := createMessage(code)
	if originalErr != nil {
		log.Printf("[ERROR] Code: %d, Message: %s, Original error: %v", code, message, originalErr)
		return fmt.Errorf("Code: %d, Message: %s, Error: %v", code, message, originalErr)
	}
	log.Printf("[ERROR] Code: %d, Message: %s", code, message)
	return fmt.Errorf("Code: %d, Message: %s", code, message)
}
