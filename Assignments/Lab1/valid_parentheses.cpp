#include <iostream>
#include <stack>
#include <string>
using namespace std;

bool isValid(string s) {
    stack<char> st;

    for (char c : s) {
        if (c == '(' || c == '{' || c == '[') {
            st.push(c);
        }
        else {
            if (st.empty())
                return false;

            char top = st.top();

            if ((c == ')' && top != '(') ||
                (c == '}' && top != '{') ||
                (c == ']' && top != '[')) {
                return false;
            }

            st.pop();
        }
    }

    return true;
}

int main() {
    string s;

    cout << "Enter a string of brackets: ";
    cin >> s;

    if (isValid(s))
        cout << "Valid Parentheses" << endl;
    else
        cout << "Invalid Parentheses" << endl;

    return 0;
}